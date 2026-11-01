# Architektur

## Schichten
- `src/lib/server/core/**` – Core-Implementierung (nur Server). Zentraler Einstieg: `core` aus `src/lib/server/core/index.ts`.
- `src/lib/sdk/{server,client,types}` – **öffentliche** Schnittstelle für Module (`defineModule`, `defineEndpoint`, `core`, `errors`, `apiFetch`, `can`, Typen).
- `src/lib/components/{ui,layout}` – UI-Bausteine (ui = shadcn/bits-ui-Wrapper, layout = fachliche Bausteine).
- `modules/<id>/` – Fachmodule (`module.ts`, `ui.ts`, `schemas.ts`, `migrations/*.sql`, Endpoints, `pages/`), **außerhalb von `src/`**.
  Ort über `tools/modules-dir.js` (`ATRIUM_MODULES_DIR`, Standard `modules/`), eingebunden vom Vite-Plugin `tools/vite-plugin-atrium-modules.ts`
  (`virtual:atrium-modules/server` → `core/modules/load.ts`, `virtual:atrium-modules/ui` → `$lib/sdk/client/module-ui-registry.ts` `moduleUiLoader`,
  Tailwind-`@source`). Import-Alias **`$modules/<id>/…`** (nicht mehr `$lib/modules`); Verträge fremder Module nur `import type` (ESLint
  `consistent-type-imports`). Plan „Kalypzo Atrium“ (Core/Module getrennt, Installation per Link): `~/.claude/plans/ok-dieses-projekt-soll-wondrous-blum.md`.
- `src/routes/**` – SvelteKit: `login/…` öffentlich, `(internal)/…` hinter Login, `api/v1/[...path]` zentraler REST-Router.
- `drizzle/` – Core-Migrationen. Modul-Migrationen liegen im Modul (`migrations/*.sql?raw`).
- **Core kennt keine Modul-IDs** (Phase 3, 2026-11-01; Wächter `tests/unit/core-no-module-ids.test.ts`): fachliches Wissen über Hooks –
  `backup.adminOnlyRestore`/`afterRestoreJobs` (statt fester `'offices'`), `ModuleDefinition.principals` (Personenquelle für Freigaben und
  `memberDeleted`, `core.modules.principalSource()`; statt fester `'members'` in `sdk/server/sharing.ts`/`privacy/member-hooks.ts`),
  `dashboard.agendaKinds` (eigene Arten in „Diese Woche“, Core kennt `meeting|event|deadline`, Feed liefert `kinds`). Mitglieder-Spaltenkatalog liegt in
  `members/sheet-columns.ts` (`MembersService.sheetCatalog`/`sheetRow`), `$lib/pdf-lists` hat nur generische Voreinstellungen (`presets.ts`).

## Request-Fluss
`hooks.server.ts`: Header → Session/Kontext (`locals.ctx: RequestContext`) → Better-Auth → Guard
(Seiten außer `PUBLIC_PAGES` leiten auf `/login`; `/modules/<id>` prüft Modulstatus).
API: `handleApiRequest` (`api/router.ts`): Modul aktiv? → Auth (Session/API-Key) → `endpoint.permission` →
Rate-Limit → Zod-Validierung (`params`, `query`, `body`) → Handler → `{ data }`-Antwort + `api_log`.

## RequestContext
`{ actor:{type:'user'|'api_key'|'system',id,name}, userId, permissions:Set<string>, ip, requestId }`.
API-Keys handeln als ihr Besitzer (`userId`), Rechte = Scopes ∩ Besitzerrechte. `system` hat immer alle Rechte.

## Das `core`-Objekt (für Module via `$lib/sdk/server`)
`auth`, `users.byIds(ctx, ids, { includeEmail? })` (Map id → Eintrag, stückelt selbst, gleiche Regeln wie `directory`; Anzeige `userLabel(map, id)`
→ „Unbekannt“ – **keine** eigenen 30er-Schleifen um `directory`), `users.directory(ctx,{search,ids,limit,includeEmail?})` (aktive Benutzer: id/name/email/image, ab 2 Zeichen, max 30; **E-Mail nur** für System,
`core.users.view`, das eigene Konto oder `includeEmail: true` nach eigener Prüfung eines Verwaltungsrechts – sonst `''`, Suche dann nur im Namen),
`crypto.forModule(id)` (`encrypt/decrypt/isEncrypted`, AES-256-GCM), `permissions` (`require`, `has`, …),
`modules` (`use`, `useOptional` für `optionalDependencies`), `settings` (Modul-Secrets mit `secretBoundTo` an Ziel-Schlüssel gebunden), `api`, `database.forModule(id).transaction`, `pdf`, `ai`, `storage`
(`upload/download/remove/stat/list/signed*`; braucht `<modul>.storage.read|write|delete` – internes Recht für Modul-Endpunkte mit Objektprüfung;
die generische REST-API `/api/v1/storage/*` verlangt `core.storage.manage`, 403 vor 503), `audit.logFromContext`.
Seit 2026-10-20 (#23/#24): `storage.downloadStream` (Inhalt als `ReadableStream`, `file.size` = Länge – für Bild-/Datei-Auslieferung),
`storage.removeMany(ctx, { module, paths })` (S3 `DeleteObjects` à 1000, Rückfall Einzel-Löschung ×8, ein Audit `core.storage.files_deleted`,
`{ removed, missing, failed }`, Metadaten fehlgeschlagener Objekte bleiben). Storage-Konfiguration 10 s gecacht, `setSettings` mit `core.storage.*`
invalidiert sofort (`invalidateStorageConfigCache`, `storage/config-cache.ts`). `getUserPermissions` nutzt den Modulstatus-Cache (3 s),
`principalKeysFor` ist je Kontextobjekt + Modul memoisiert (WeakMap, 5 s). Bild-Endpunkte: `IMAGE_RATE_LIMIT` (1200/60 s) aus `$lib/sdk/server`.
Seit 2026-10-22: `permissions.usersWith(key)` (aktive Konten mit wirksamem Recht, ohne Prüfung, für Benachrichtigungen), `mail.sendMessage`
mit `messageId`/`inReplyTo`/`references` → `{ messageId }`, `mail.send({ autoSubmitted })` (`Auto-Submitted` + `X-EP-Intern`).
Seit 2026-10-25: `notifications.send(ctx, moduleId, items)` (E-Mail/Web Push nach Wahl der Person, siehe „Benachrichtigungen und PWA“) und `notifications.migratePreferences`.
`pdf.labels(ctx, { title, format, layout, labels, startIndex?, outlines? })` (seit 2026-10-27, `core/pdf/labels.ts`): Etiketten als PDF (Bogen/Rolle, freie Seitengröße, Barcodes per bwip-js), Modell in `$lib/sdk/labels`.
`pdf.renderPage(bytes, { page?, maxEdge?, timeoutMs? })` (seit 2026-10-26, `core/pdf/raster.ts`): eine PDF-Seite als PNG (pdf.js + `@napi-rs/canvas`,
kein Chromium; ≤ 50 MB, ≤ 4 MP, 10 s, ein Lauf je Prozess, Nicht-PDF 422) – für Vorschaubilder, danach durch `images.process` (sharp bleibt für PDF gesperrt).
`ai` (`generate`, `generateJson`, `stream`, `usage`); darauf die **Schreibhilfe** (seit 2026-10-29, `core/ai/assist/`): Module melden Textstellen in
`ModuleDefinition.assist` an, REST `GET /ai/assist/status` + `POST /ai/assist` (SSE, nur Session), Details `docs/core-services.md` → „Schreibhilfe“.
`images.process(bytes, { variants })` (sharp, nur Core): Inhalt prüfen (JPEG/PNG/WebP/AVIF/GIF, ≤ 50 MP), nach EXIF drehen,
**alle Metadaten inkl. GPS entfernen**, Varianten (WebP/JPEG/PNG) mit Maßen; Typen `ImageVariantSpec` & Co. über `$lib/sdk/server`.

## Datenbank
- Jedes Modul hat genau ein Schema `mod_<id>` (Bindestrich → Unterstrich). `forModule(id).transaction` setzt
  `SET LOCAL search_path TO "mod_<id>"` – Core-Tabellen sind dort **unqualifiziert** nicht erreichbar (Konvention, kein Sicherheitsmechanismus;
  `forModule` nur mit eigener `MODULE_ID`, ESLint meldet fremde Literale).
- Tabellen in Migrationen **unqualifiziert** anlegen; Fremdschlüssel auf Core-Tabellen gibt es nicht
  (`user_id text` ohne FK; Namen über `core.users.directory` auflösen).
- Rohe Abfragen: `tx.execute(sql\`…\`)` mit `import { sql } from 'drizzle-orm'`. Grundhelfer **nur** aus `$lib/sdk/server` (`sdk/server/db.ts`,
  Implementierung `core/database/rows.ts`, auch für Core): `moduleDb(id)`, `rowsOf(tx, sql)`, `resultRows(res)`, `type Row`, `inList(ids)` (leere Liste →
  `NULL`, also `IN (NULL)` trifft nie; **`NOT IN` vorher selbst prüfen**), `toIso`/`toIsoOrNull`, `str`, `num`, `userLabel` – keine lokalen Kopien (#70).
- Treiber-Unterschiede (`tx.execute`, geprüft 2026-10-21, #60): `timestamptz`/`date` kommen bei **beiden** als String (drizzle reicht sie roh
  durch) → immer `toIso(v)` (behält auch bei `Date` die Millisekunden, `new Date(String(date))` nicht); `int8` (`count(*)`, `::bigint`, `sum`) liefert `pg` als **String**, PGlite als `number`
  → immer `Number()`/`num()`. Test: `tests/integration/pg-concurrency.test.ts` (nur mit `TEST_DATABASE_URL`).
- PGlite (Tests/Demo) hat **eine Sitzung**: keine verschachtelten Core-Aufrufe in offenen Transaktionen, Pool im Demo auf 1.
- Migrationen werden vom Runner in Einzel-Statements zerlegt (`modules/split-sql.ts`: Strings inkl. `E'…'`, verschachtelte Kommentare, `$tag_1$`); `CREATE … IF NOT EXISTS`.
- Auch **Modul-Migrationen** laufen nur mit `search_path TO "mod_<id>"` (ohne `public`), danach `TO DEFAULT`; Core- und Modul-Migrationen unter der Advisory-Sperre `MIGRATION_LOCK_KEY` (`database/migrate.ts`, #73).
- Geld in **neuen** Spalten als `bigint`; FKs im Modulschema mit Index; Formate zusätzlich als `CHECK` (`NOT VALID` → bereinigen → `VALIDATE`), siehe `docs/database.md`.

## Fehler und Audit
- `errors.notFound|forbidden|validation|badRequest|conflict|unauthenticated|tooLarge|unavailable` (`$lib/sdk/server`).
  HTTP: 400/403/404/409/422/401/413/503. Texte deutsch mit echten Umlauten.
- Fremde Objekte → `notFound` (nicht `forbidden`), damit Existenz nicht verraten wird.
- Mehrschritt-Änderungen: erst alle Prüfungen, dann **eine** Transaktion (Muster `updateUserFull` für `PATCH /users/:id`). Nebenarbeiten (Mail/Audit) über `bestEffort`/`logBestEffort` (`$lib/sdk/server`), nie `catch {}` ohne Log.
- Zod-Standardmeldungen sind deutsch (`src/lib/zod-locale.ts`, importiert in `hooks.server.ts`, API-Router und Root-Layout).
- Audit **nach** der Transaktion: `core.audit.logFromContext(ctx, 'modul.ressource.aktion', { target, metadata })`.
  Keine personenbezogenen Details (Geburtsdatum, Allergien, E-Mail, IBAN) in `metadata`.

## Konto, Darstellung, Startseite (Core)
- E-Mail-Wechsel (`core/auth/profile.ts` `requestEmailChange`): Passwort selbst prüfen (Better Auth prüft es nicht;
  5 Fehlversuche/10 min), Hinweis an die alte Adresse, Link (1 h) an die **neue** Adresse. Neutrale Antwort auch bei belegter
  Adresse. `/verify-email` ohne Session → Redirect `/login` (keine Session über den Link, 2FA). Rate-Limit `/change-email`
  5/300 s, `/update-user` 20/300 s. Audit `core.auth.email_change_requested|email_changed` mit maskierten Adressen (`a***@domain`).
  Admin `updateUser` mit neuer Adresse: `emailVerified=true`, alle Sessions des Benutzers widerrufen, Duplikat 409.
- **Schutz bei Kontoänderungen** (2026-10-20, #4): `assertCanManageUser(ctx, targetId)` / `canManageUser` (`core/auth/manage-guard.ts`) –
  die handelnde Person braucht **alle wirksamen Rechte** des Zielkontos (`getUserPermissions`, inkl. `user_role_grant`), sonst 403; System und
  eigenes Konto ausgenommen. Aufgerufen in `updateUser` (alle Felder), `setUserActive`, `deleteUser`, `setUserRoles`, `setUserAvatar`/`removeUserAvatar`.
  Administrativer E-Mail-Wechsel: Hinweismail an die **alte** Adresse (Fire-and-forget), Audit `core.user.updated` mit `emailFrom`/`emailTo` maskiert;
  `core.user.created` speichert die Adresse nur maskiert. `/admin/users`: Zeilen mit `manageable: false` → Knöpfe gesperrt + Hinweis.
- **Konto löschen** (#8): `deleteUser` → Core-Zeile weg → `removeAvatarObject` → `cleanupModulesAfterUserDeletion` (Hook `onUserDeleted` je aktivem
  Modul, eigene Modul-Transaktion, danach `afterCommit`; Fehler → Log + Audit `cleanupFailed`). Details: `docs/module-development.md`.
- **Mitglied gelöscht/anonymisiert** (#30): `core.modules.memberDeleted('members', { memberIds, reason })` (`core/privacy/member-hooks.ts`, nur `members`
  darf auslösen) → Hook `onMemberDeleted` aller anderen aktiven Module. **Datenauskunft** `/admin/privacy` (Recht `core.privacy.export`, privilegiert):
  `core/privacy/service.ts` `findPrivacySubjects`/`exportSubject` → Core-Daten + `ModuleDefinition.subjectExport` (`resolve`, `run`), JSON-Download per
  Formular-POST `/admin/privacy/export`, Audit `core.privacy.exported`. Details: `docs/security.md` → „Löschkonzept und Betroffenenrechte“.
- Profilbild: `setOwnAvatar` → Storage `core/avatars/<userId>` (braucht S3, sonst 503), `user.image=/avatar/<id>?v=…&n=1`, Auslieferung `GET /avatar/<userId>`.
  Seit #19 wird nie das Original gespeichert: Magic-Bytes-Prüfung, dann `processImage` (WebP, `maxEdge` 512, Qualität 82, ≤ 2 MB Eingabe; erkanntes Format
  muss zum angegebenen Typ passen, sonst 400) → nur die WebP-Variante (ohne EXIF/GPS). Bestand: stündlicher Core-Job `core.avatars-reprocess`
  (`reprocessLegacyAvatars`, idempotent über Marker `n=1` im `user.image`; unlesbare/fremde Bilder → `image = NULL`).
  Verwaltung (2026-10-19): `setUserAvatar`/`removeUserAvatar` (`core/auth/profile.ts`, Recht `core.users.edit`, unbekannt 404, gleiche Typ-/Größen-/Magic-Bytes-Prüfung),
  Aktionen `setAvatar`/`removeAvatar` auf `/admin/users` (Bereich „Profilbild“ im Bearbeiten-Dialog, Avatar in der Liste; `UserListItem.image`). Audit wie beim eigenen Bild, mit `byAdmin: true`.
- Theme: Cookie `theme` ist SSR-Quelle, `core.user.theme` (nur bei ausdrücklicher Wahl) gewinnt beim `(internal)`-Load;
  `theme.set()` schreibt zusätzlich per `POST /profile/theme`. `hooks.server.ts` ersetzt `%app.theme%`, `%app.density%`,
  `%app.style%` (`--accent-color`, nur validiertes `#rrggbb`) in `app.html`; Inline-Skript setzt `dark` bei „system“ (CSP-Nonce).
- **Persönliche Themes** (2026-10-26): `$lib/appearance/` (Client + Server): `schema.ts` (Zod `userThemeSchema`: Name, `accent` `''|#rrggbb`,
  `light`/`dark` = `{ background: solid|linear|radial|mesh, veil 0–90 %, sidebar glass|tinted|solid }`, ≤ 20 je Person), `presets.ts` (10 Vorschläge
  `preset:<slug>`, `resolveTheme`), `css.ts` (`cssBackground`, `themeCssVars`, `previewBackground`, `textContrast`/`isReadable`, `deriveDark`), `apply.ts`
  (Browser). Einstellungen `core.user.themes` (JSON) + `core.user.activeTheme` (Scope `user`). `loadUserPrefs` liefert `themes`/`activeTheme` (tolerant
  validiert); `applyAppearance` setzt `%app.apptheme%` (`data-app-theme="on"`) und die Variablen in `%app.style%` – SSR ohne Aufblitzen.
  Wirksame Akzentfarbe `effectiveAccent`: Theme → eigene → System. Profil-Actions `saveTheme`/`deleteTheme`/`activateTheme`/`toggleFavorite`.
  **Favoriten** (Stern, `core.user.themeFavorites`, ≤ 30, eigene + Vorschläge; `loadUserPrefs` → `favorites`, verwaiste IDs fallen weg): nur sie stehen
  in der Schnellwahl der Kopfzeile (`themeChoices`, Wechsel über `POST /profile/theme { activeTheme }`); neue eigene Themes werden automatisch Favorit,
  Löschen entfernt den Favoriten. UI: Profil → Darstellung, Karte „Theme“ (`ThemesCard`, `ThemeEditorDialog` mit Live-Vorschau).
  Tests `appearance.test.ts`, `user-prefs`, `hooks-server`, Integration `profile-extra`, E2E `appearance-themes.spec.ts`.
- **Dashboard neu (2026-10-29)**: Frage der Seite „Was muss ich jetzt tun, und was steht diese Woche an?“. Core-Kacheln `core:todos`
  („Zu erledigen“, eine Liste quer über Module, je Zeile eine Handlung, nur die dringendste als gefüllter Knopf, Zahlungsdaten aufklappbar)
  und `core:week` („Diese Woche“, Mo–So, Arten Gruppenstunde/Termin/Aktion/Material/Frist, heute in Akzentfarbe) aus
  `ModuleDefinition.dashboard` (`todos`/`agenda`, Regeln wie `search`) über `GET /dashboard/feed` (`core/dashboard/feed.ts`,
  `collectDashboardFeed`); unter dem Titel ein Befundsatz (`feedFinding`). Modul-Kacheln, deren Inhalt dort aufgeht, sowie Kennzahlen,
  Aktivitäten, Schnellzugriff, Ämter, Whiteboards, Zuletzt geändert sind `defaultHidden`. Neue Kacheln mit `order` < 5 landen auch bei
  gespeicherter Anordnung oben (`TOP_ORDER`). Raster 2 Spalten. Konzept/Mockup: Artifact „EP Intern Übersicht“. Tests `dashboard-feed*`.
- Dashboard (2026-10-20): `dashboard/+page.ts` sammelt `dashboardWidgets` aktiver Module + `CORE_DASHBOARD_WIDGETS` (Pseudo-Modul `core`),
  `selectDashboardWidgets`/`applyDashboardLayout` (`$lib/sdk/client/dashboard-widgets`); Core-Daten `GET /dashboard/core` (je Recht), Anordnung
  `PUT /dashboard/layout` (`core.user.dashboard`, Origin-Check, `null` = Standard). Tests `dashboard-widgets`, `dashboard-layout`, E2E `dashboard.spec.ts`.
- `/` und Login ohne `redirectTo` leiten auf `core.user.startPage` (erlaubt: Dashboard, Profil, Modul-Navigation).

## Protokolle und Aufbewahrung (2026-10-20)
- `api_log` speichert das **Endpunkt-Muster** (`apiLogPath` in `api/router.ts`, ohne Treffer token-artige Segmente → `:param`), nie Tokens.
  `GET /api/v1/health` prüft die DB (`api/health.ts`, `SELECT 1`, 2 s, sonst 503) und wird **nicht** protokolliert (`UNLOGGED` im Router).
- Core-Jobs: `CORE_JOBS` in `core/jobs/index.ts` (Schlüssel `core.<id>`, immer aktiv, nach den Modul-Jobs). `core.housekeeping` (täglich,
  `jobs/housekeeping.ts`): `api_log` nach `core.retention.apiLogDays` (30) löschen, `audit_log`-IP nach `auditIpDays` (90) leeren, Einträge nach
  `auditDays` (730, 0 = nie) löschen – nur mit `SET LOCAL app.audit_retention = 'on'` (Migration 0007; UPDATE nur `ip → NULL`). Audit
  `core.system.housekeeping` nur mit Zählern. Einstellungen: Verwaltung → Einstellungen → Allgemein. Indizes `audit_log_target_idx`,
  `audit_log_action_pattern_idx` (0007). Tests `core-housekeeping`, `core-health`, `api-log-path`.

## Live-Updates (2026-10-26)
- Muster für Echtzeit (erste Nutzerin: `whiteboard`): **Server-Sent Events** über einen normalen Modul-Endpunkt (Handler gibt eine `Response` mit
  `ReadableStream` zurück, `text/event-stream`, `x-accel-buffering: no`, Heartbeat), Änderungen per POST. Verteilung im Prozess → **eine Instanz**.
  Kein WebSocket (adapter-node ohne Upgrade-Hook). Im Stream keine offene Modul-Transaktion halten; Zugriff regelmäßig neu prüfen.
- Vollflächige Modulseiten: `ModuleUi.fullBleedRoutes` → Catch-all `+page.ts` setzt `fullBleed`, `(internal)/+layout.svelte` lässt Rand/`max-w` weg.

## Sicherheit
Security-Header und CSP aus `hooks.server.ts`/`svelte.config.js`; CSRF über SvelteKit-Origin-Check.
Öffentliche Modul-Endpoints sind **verboten** (`permission` darf nicht `null` sein) – Phase 3 führt ein
kontrolliertes Opt-in (`public: true`, Pflicht-Rate-Limit) ein. Details: `docs/security.md`.
Nutzereingaben nie als `{@html}` ausgeben; CSV-Exporte gegen Formel-Injection (`= + - @`) absichern.
**Admin-gleiche Rechte** (`PRIVILEGED_PERMISSIONS`: `core.system.backup|reset`) vergeben nur Administrator*innen (`isAdministrator` = alle
Core-Rechte; Prüfung zentral in `assertCanGrant` → Rollen, Zuweisung, API-Keys, Ämter); Restore von `core:users|roles|api-keys`/`offices` nur
für Admins, nie zusätzliche Rollen für die ausführende Person. **Einstellungen**: `setSettings(ctx, values)` atomar (≤ 100 Schlüssel),
`writePermission` je Schlüssel (Modul mit `<modul>.settings.manage` → dieses Recht), Ziel-Wechsel (SMTP-Host/Port/User, KI-URL,
Storage-Endpoint) verwirft das gebundene Secret (`SECRET_BINDINGS`). Details: `docs/permissions.md`, `docs/security.md`.
Client-IP **nur** über `core/auth/client-ip.ts` (`clientAddress(event)`, `currentClientIp(headers)`; `hooks.server.ts` setzt den internen Header
`x-ep-client-ip`, Better Auth liest nur ihn) – nie `X-Forwarded-For` selbst auswerten. Auth-Form-Actions begrenzen über `limitAuthAction`
(`core/auth/auth-limits.ts`, gleiche Werte wie Better-Auth-`customRules`), weil `getAuth().api.*` dessen Limiter umgeht. Login-Audits nur mit
`maskEmail`/`maskEmailInput`; `sanitizeMetadata` bereinigt personenbezogene Schlüssel (Blockliste) mit Warnung im Log.

## Öffentliches Multipart und Admin-Reset (2026-10-18)
- `ApiEndpoint.multipart { maxBytes ≤ 12 MB, maxFiles ≤ 10 (Standard 1) }` nur für `public: true` + POST + `body`: Router verlangt
  `multipart/form-data` + `Content-Length` (413 bei Überschreitung), Textfelder → `body`-Zod (doppelte Felder/`__proto__` → 400), Dateien → `files`.
- Reset (`core/system/reset.ts`, Recht `core.system.reset`, Seite `/admin/reset`): `listResetAreas` → `previewReset` (Token 15 min, im Prozessspeicher)
  → `exportResetData` (Passwort + TOTP bei 2FA + Sicherungs-Passwort → verschlüsselte `.epbackup` über `writeBackupFile`, Modul-Teilbereiche → ganzes Modul) → `executeReset` (Wort `ZURÜCKSETZEN`). Bereiche: Core (`core:audit|api-log|jobs|
  ai-usage|api-keys|users|roles|settings`) + `ModuleDefinition.resetAreas` (`<modul>:<id>`, `implies` transitiv, `rebuild` = Schema neu inkl. Startdaten)
  + `resetUsers(tx, keepUserId)`. Jobs pausiert; Reihenfolge Module → Benutzer → Core → Dateien (`core.storage.purge`) → Einstellungen (Storage/SMTP/Secrets
  bleiben) → Audit (DELETE nur mit `SET LOCAL app.audit_reset = 'on'`, Migration 0005) → Eintrag `core.system.reset`.

## Modul-Installation (Kalypzo Atrium Phase 5, 2026-11-01)
- `src/lib/server/core/modules/install/`: `archive.ts` (sicheres ZIP im Speicher, `contentHash`), `github.ts` (nur api/codeload, Ref → SHA,
  `setGithubFetchForTests`), `discover.ts` (Katalog → `modules/*` → Einzelmodul), `analyze.ts` (Aktion install/update/reinstall/unchanged/downgrade,
  Rechte-Diff, neue Migrationen, veränderte angewendete Migration **sperrt**, npm-Konflikt mit `CORE_PACKAGES`, Import-Scan), `resolve.ts`
  (harte Abhängigkeiten: gleiche Quelle → `source`-Link → Fehler; optionale = Empfehlung; Zyklen, Rückwärts-Bereiche), `service.ts`
  (`inspectSource` → `previewInstall` → `confirmInstall`, Sitzungen 15 min, `installStatus`, Verlauf).
- Recht `core.modules.install` (privilegiert) + `isAdministrator` + Sitzung + Re-Auth. Einstellungen `core.modules.githubToken` (Secret),
  `core.modules.allowedSources`. Core-Migration **0012** `module_install` (Wunschzustand je Modul) und `module_install_event` (Verlauf).
- Ausführen je `ATRIUM_MODULE_INSTALL`: `off` (Standard Produktion, nur Vorschau), `copy` (Standard bei `NODE_ENV=development`: Dateien nach
  `runtimeModulesDir()`, danach Neustart/Neuladen), `supervisor` (Phase 6). Seiten `/admin/modules` (Reiter Installiert · Installieren · Verlauf,
  `admin-registry.ts` `modules.install`/`modules.history`). Tests `tests/unit/module-install.test.ts`, `tests/integration/module-install.test.ts`
  (GitHub-Ersatz + Fixture-Module), Helfer `tests/helpers/module-zip.ts`.

## Supervisor und Neubau (Kalypzo Atrium Phase 6, 2026-11-01)
- `scripts/supervisor/lib.mjs` (`Supervisor`, `contentHashOfDir` = gleiche Regel wie `archive.ts` `contentHash`, `mergeLock`, `modulePackagesFor`),
  Startpunkt `scripts/supervisor.mjs` (Image-`CMD`), genutzt von `scripts/demo-server.mjs` und `scripts/e2e-install-server.mjs`.
  Datenverzeichnis `ATRIUM_DATA_DIR`: `state.json` (current/previous), `gen/<id>/{modules,build,.svelte-kit,BUILD_INFO.json,atrium-modules.lock.json}`,
  `gen/<id>/node_modules` = Junction auf den Core, `staging/<planId>`, `results/<planId>.json`, `status.json`, `logs/`.
- Neubau ohne Schreibzugriff auf den Core: `ATRIUM_BUILD_OUT` (adapter-node `out`), `ATRIUM_KIT_OUT_DIR` (`kit.outDir`), `ATRIUM_VITE_CACHE`
  (`svelte.config.js`, Vite-Plugin), Modul-npm-Pakete per `ssr.noExternal` (`modulePackages`).
- App-Seite: `core/lifecycle.ts` (`installShutdownHandlers`: IPC `atrium:shutdown` → `SIGTERM` an adapter-node → `sveltekit:shutdown` → Jobs anhalten
  (`stopJobRunner`), Pool schließen; `runVerifyAndExit` für `ATRIUM_VERIFY_ONLY=1`), `core/modules/install/supervisor-link.ts` (Staging, IPC
  `atrium:build`, `readSupervisorStatus`, `reconcileInstallEvents` in `initCore`: `requested` → `done`/`failed`, erst dann `module_install`).
  Panel fragt `/admin/modules/install/status` alle 2 s ab (Neustart = kurz offline).
- Tests: `tests/unit/supervisor-lib.test.ts`; echter Neubau `npx playwright test -c playwright.install.config.ts` (`tests/e2e-install/`, Port 4174).

## Lebenszyklus der Module (Kalypzo Atrium Phase 7, 2026-11-01)
- `core/modules/install/manage.ts`: `checkUpdates` (GitHub-Kopf vs. gespeicherter Commit), `uninstallModule` (nur deaktiviert + kein Modul braucht es;
  Daten behalten oder `deleteModuleData`: Schema, `module_migration|state`, `permission` (CASCADE), `role_grant_applied`, `user_role_grant`, Einstellungen
  `<id>.*`, `notification_pref`, `job_run`, Dateien), `installDrift`/`restoreFromDatabase` (Wunschzustand ↔ laufender Stand, Neubau aus Quelle+Commit
  bzw. ZIP-Cache `ATRIUM_DATA_DIR/sources`), `syncInstallsFromLock` (in `initCore`). Vorschau zeigt `fileChanges` (Dateien gegen das Modulverzeichnis).
- Datensicherung: `backup.json` → `modules.<id>.origin` (Quelle, Commit, Inhaltshash, optional), Bereich `core:settings` umfasst `module_install` +
  `module_install_event`; `checkCompat` liefert für fehlende Module `installSource` (Link zur Installation im Import-Assistenten).
- Supervisor-Seed `scripts/supervisor/seed.mjs` (`ATRIUM_MODULES_SEED` Datei/JSON oder `deploy/modules.seed.json`, nur volle Commits).
- UI `/admin/modules`: Herkunft je Modul, „Nach Updates suchen“, „Entfernen …“ (Dialog, Bestätigung per ID), Hinweis + „Aus der Datenbank
  wiederherstellen“; `/admin/modules/install?url=…&select=…` belegt vor. Tests `module-lifecycle.test.ts`, `supervisor-seed.test.ts`,
  `backup-compat.test.ts`, E2E `tests/e2e-install` (installieren + entfernen).

## Einzelrechte am Benutzer (2026-10-21)
- Tabelle `user_permission` (Core-Migration 0009): Rechte direkt am Benutzer zusätzlich zu Rollen; `getUserPermissions` vereinigt sie
  (Modulrechte nur bei aktivem Modul). Vergabe in `auth/users.ts` (`permissionKeys`, `planUserPermissions`) mit denselben Regeln wie Rollen
  (`core.roles.assign`, `assertCanGrant`, `assertCanManageUser`). UI `admin/_shared/PermissionPicker.svelte`. Details: `docs/permissions.md`.

## Freigabe an Principals (2026-10-18)
- Generische Objekt-Freigabe für Module: Typen in `$lib/sdk/types/sharing.ts` (Client + Server), Logik in `$lib/sdk/server/sharing.ts`
  (über `$lib/sdk/server` exportiert). Principal-Typen `everyone` (ID `*`, „Stamm“), `group` / `member` (aus `members`), `role`, `user`.
  Schlüssel `typ:id` (`principalKey`, `parsePrincipalKey`), z. B. `group:<id>`, `everyone:*`.
- Tabellenmuster im Modulschema: `<obj>_shares(<obj>_id FK CASCADE, principal_type CHECK …, principal_id, level CHECK read|edit, created_by,
  created_at, PK (<obj>_id, principal_type, principal_id))` + Index `(principal_type, principal_id)`. Vorlage: `events/migrations/0001_init.sql`.
- Ablauf: `const keys = await principalKeysFor(ctx, '<modul>')` **vor** der Transaktion (ruft Core + `members` auf, PGlite), in SQL
  `principalMatchSql('s', keys)` (`(s.principal_type || ':' || s.principal_id) IN (…)`, leere Liste → `FALSE`, Alias nur `[a-z_][a-z0-9_]*`).
  Schlüssel des Aufrufers: `everyone:*`, `user:<id>`, alle `role:<id>` (`core.users.roleIds`), dazu `member:<id>` der verknüpften, nicht
  ausgetretenen Mitglieder und `group:<id>` ihrer Gruppen (Mitgliedschaft **und** Leitung). Ohne `userId` nur `everyone:*`.
- Weitere Helfer (alle nach/vor der Transaktion): `searchPrincipals(ctx, modul, q, { everyoneLabel, types?, limitPerType? })` (ab 2 Zeichen,
  Reihenfolge everyone, group, role, member, user), `describePrincipals` (Anzeige, Unbekannte = „Unbekannt“), `validatePrincipals` (422,
  Pfad `[pathPrefix ?? 'shares', i, 'id']`, `everyone` nur mit `*`).
- `members` als `optionalDependencies` (`core.modules.useOptional`, ohne aktives `members` entfallen Gruppen/Mitglieder still, Validierung → 422)
  **oder** `dependencies` (`core.modules.use`, z. B. `actions`); ohne Deklaration wirft jeder Helfer einen `Error` (Programmierfehler).
  Vertrag `PrincipalProvider` (`listGroups` → `PrincipalGroupRef` inkl. `meetingEndTime`, `principalIdsForUser`, `searchMemberPrincipals(ctx, …)`)
  steht **nur** in `$lib/sdk/types/sharing.ts`; `members/contract.ts` (`MembersService extends PrincipalProvider`) und
  `members/principals.service.ts`/`module.ts` (`satisfies`) bauen darauf auf. `MembersService.searchMembers` bleibt ohne Rechteprüfung (Systemfunktionen).
- **Datenschutz (2026-10-20, #5)**: `searchPrincipals`/`describePrincipals` werten `ctx` aus – `member` nur mit `members.member.view`
  (`searchMemberPrincipals` prüft zusätzlich selbst; gespeicherte Mitglieds-Freigaben ohne Recht nur als „Mitglied“), E-Mail als `detail` nur mit
  `core.users.view`. **Gruppen bleiben bewusst für alle sichtbar** (keine personenbezogenen Daten, ohnehin in `events` `GET /groups` und auf der
  Website, nötig zum Teilen mit der eigenen Gruppe). `validatePrincipals` prüft nur die Existenz (System-Kontext, gibt nichts aus).
- Freigabe-Suchen (`GET /principals` in events/galleries/files, `actions` `GET /users`): `requireShareCapability(ctx, modul, { anyPermission,
  canShareSql })` → 403 für Personen, die nichts teilen können (events/galleries: `create`/`edit-all`/Eigentum/`edit`-Freigabe; files: `manage-all`
  oder eigener Knoten; actions: `edit-all` oder eigene Aktion), Rate-Limit `PRINCIPAL_SEARCH_RATE_LIMIT` (60/60 s). Test `principals-privacy.test.ts`.
- Core: `core.roles.directory(ctx, { search, ids, limit })` (id/name, nur Anmeldung nötig, Suche ab 2 Zeichen, max. 30) und
  `core.users.roleIds(userId)`. UI: `SharePanel`/`ShareMenu`/`ShareDialog` mit `type` und `everyoneLabel` (siehe `ui-design.md`).
- **Benachrichtigungs-Empfänger** (2026-10-25): `principalUserIds(modul, principals, { permission, exclude?, everyone? })` (SDK) → aktive Konten mit Leserecht
  (`user` direkt, `role` über `core.roles.userIds`, `member`/`group` über `PrincipalProvider.userIdsForPrincipals` = verknüpfte Konten der Mitglieder bzw.
  Gruppenmitglieder und Leitungen, `everyone` nur mit `everyone: true`); `addedPrincipals(before, after)` für „neu geteilt“.
- **Zugriffsbaustein** (#35, `$lib/sdk/server/share-access.ts`): `createShareAccess({ table, shareTable, fk, ownerColumn?, perms: { viewAll, editAll },
  readIf?: { column, equals }, notFoundText, forbiddenText })` → `canEditAll`, `canViewAll`, `resolveAccess`, `requireAccess` (404/403), `visibleFilter(ctx, keys,
  alias)`, `accessForMany`, `loadShares`, `replaceShares`. `events`/`galleries` (`readIf` = öffentlich) haben in `access.ts` nur noch Konfiguration; `files`
  (Ordnervererbung) nutzt die Bausteine `shareLevelOn`, `loadObjectShares`, `replaceObjectShares` mit `NODE_SHARES`. Neue Module (z. B. `actions`-Umstellung)
  bauen darauf auf. Test `tests/integration/share-access.test.ts` (Zugriffsmatrix mit Testtabelle).
- Nutzer: `events` (siehe `module-events.md`), `galleries`, `files`, `website`, `actions` (seit 2026-10-25, Migr. 0022) und `tasks` (Boards, zusätzlich Vererbung über die Aktion).

## Rollen aus Modulen (2026-10-19)
- Core-Tabelle `user_role_grant(user_id, role_id, module_id)` (Migration `drizzle/0006_user_role_grant.sql`, FK auf `user`/`role` mit CASCADE): Rollen, die ein
  **Modul** verleiht (erster Nutzer: `offices` – Inhaber*innen bekommen die Rollen ihrer Ämter). Getrennt von `user_role` (manuell), daher bleiben
  manuelle Zuweisungen unberührt.
- Wirksam nur bei **aktivem** verleihendem Modul: `getUserPermissions` (`permissions/service.ts`) und `roleIdsForUser` (`permissions/roles.ts`, = `core.users.roleIds`)
  filtern nach `enabledModuleIds`. Deaktivieren entzieht die Rechte sofort, die Zeilen bleiben (Aktivieren stellt sie wieder her).
- API für Module (`permissions/grants.ts`, über `core.roles`): `replaceModuleGrants(moduleId, [{ userId, roleIds }])` ersetzt **alle** Zeilen des Moduls atomar
  (unbekannte Benutzer/Rollen still übersprungen, **keine** Rechteprüfung, nie in einer Modul-Transaktion), `listModuleGrants(moduleId, { userId? })`,
  `assertCanGrant(ctx, roleIds)` (403, wenn dem Aufrufer Rechte einer Rolle fehlen – vor dem Ersetzen aufrufen). `core.roles.directory` kennt `all: true` (≤ 200).
- Reset: Core-Bereiche `users`/`roles` löschen passende Zeilen mit; ein Modul-`rebuild` löscht die Zeilen des Moduls. Details: `module-offices.md`.

## Verwaltung unter `/admin` (2026-10-19)
- Alle Verwaltungsseiten liegen unter `src/routes/(internal)/admin/`: `/admin` (Übersicht mit Abschnitten und Suche, `?q=`), `/admin/users`,
  `/admin/roles` (+ Reiter `/admin/roles/permissions`), `/admin/settings` → Reiter `/admin/settings/{general,design,mail,mail-layout,storage,ai,pdf,modules}`
  (`/admin/settings` leitet auf den **ersten erlaubten** Reiter), `/admin/modules`, `/admin/api` (API-Keys, + Reiter `/admin/api/docs` = API-Übersicht),
  `/admin/audit`, `/admin/reset`. Gemeinsame Server-Helfer in `admin/_shared/` (`SettingsForm`, `group-form.server`, `server-utils`).
- **Einzige Quelle**: `src/lib/components/layout/admin-registry.ts` (`ADMIN_SECTIONS`, `ADMIN_ENTRIES` mit `section`, `permission`/`anyPermission`,
  `keywords`, `nav`, `parent`). Daraus entstehen Seitenleiste (`buildAdminNav` in `nav.ts`: Gruppe „Administration“ mit „Übersicht“ und den `nav`-Einträgen),
  Übersicht, Befehlspalette und Reiter (`adminTabs(parent, perms)`). Helfer: `canSeeAdminEntry`, `visibleAdminEntries(perms, navigation)` (+ Modulseiten
  mit `admin: true` als Abschnitt „Module“, Label = `moduleName`), `searchAdmin` (Umlaute/ß gefaltet, alle Wörter UND, Label vor Keyword vor Beschreibung).
- Abschnitte: Personen & Rechte / Einstellungen / Module / Schnittstellen / Protokoll & Wartung.
- **Alte URLs** (`/users`, `/roles`, `/permissions`, `/modules` **exakt**, `/api-keys`, `/api-docs`, `/settings[/…]`, `/ai`, `/storage`, `/pdf[/…]`, `/audit`,
  `/system/reset[/…]`) → **308** per `legacyAdminRedirect` (`src/lib/server/core/admin-redirects.ts`) im `guard` von `hooks.server.ts`; Unterpfade und Query
  wandern mit, `/modules/<id>/…` bleibt die Moduloberfläche.
- Reiter als Links: `LinkTabs` (eigene URL je Reiter, `aria-current`, Optik wie `Tabs variant="line"`), Layouts in `admin/{settings,roles,api}/+layout.svelte`.
- **Befehlspalette** `CommandPalette` (Strg/⌘+K, Topbar-Button „Suchen“): Dashboard, Modulseiten und alle sichtbaren Verwaltungseinträge (lokal)
  **plus Datensuche** (2026-10-20): ab 2 Zeichen, 250 ms verzögert `GET /search?q=` (`src/routes/(internal)/search/+server.ts` →
  `core/search/service.ts` `searchEverything`): Core (Benutzer*innen `core.users.view`, Rollen `core.roles.view`) + `ModuleDefinition.search`
  (`ModuleSearchProvider { permission?, anyPermission?, run(ctx, q, limit) }`) aktiver Module, nur mit Recht, nacheinander (mit echtem `pg`-Pool > 1 Verbindung parallel, Zeitbudget 3 s je Quelle,
  `databaseAllowsParallelQueries`; `principalKeysFor` je Request einmal, #68), je Quelle ≤ 5,
  Fehler einer Quelle übersprungen, nur relative Links (`isSafeHref`). Typen `$lib/sdk/types/search`. Quellen: members (Mitglieder `?open=`, Gruppen),
  actions, events (`?event=`), galleries, files, offices, orders, treasury (Rechnungen, Zahler `?payer=`, eigene Rechnungen mit `own.view`).
  Tests `search-core`, `search-modules-a|b`, E2E `search.spec.ts`.
- **Sidebar** scrollt eigenständig: Desktop `sticky top-0 h-dvh` mit eigenem Scrollbereich, mobil Sheet mit festem Kopf und scrollbarer Liste.
- **Sidebar einklappbar** (Desktop, 2026-10-29): Knopf „Einklappen“ unten → Symbolleiste `w-14` (nur Icons, Name als `Tooltip` rechts, Zähler als Punkt,
  Gruppen-Icon klappt aus und öffnet die Gruppe). Zustand je Gerät im Cookie `sidebar=collapsed|open`, `(internal)/+layout.server.ts` liefert
  `sidebarCollapsed` für SSR ohne Springen. `AppSidebar` (`collapsed`, `ontoggle`), `SidebarNav` (`collapsed`, `onexpand`). E2E `sidebar.spec.ts`.
- Reiter **Einstellungen → Module** (`/admin/settings/modules`): generische Formulare aus `ModuleDefinition.settings` aktiver Module; Module mit eigener
  Einstellungsseite (Navigation mit `admin: true`, z. B. Kasse) erscheinen nur als Link.
- Header-Check: nur `/admin/settings/mail-preview` (E-Mail-Vorschau im iframe) bekommt `x-frame-options: SAMEORIGIN`, alles andere `DENY`.
- Neue Verwaltungsseite = Route unter `admin/` **plus** Eintrag in `admin-registry.ts` (Tests: `tests/unit/admin-registry.test.ts`, `admin-redirects.test.ts`,
  E2E `tests/e2e/admin-nav.spec.ts`).

## Benachrichtigungen und PWA (2026-10-25)
- `core.notifications` (`core/notifications/`: `service.ts` Versand/Profil/Übernahme, `catalog.ts` Typen aus `ModuleDefinition.notifications`, `prefs.ts`,
  `push.ts` VAPID/Geräte/`web-push`, `compose.ts` Texte, `endpoints.ts`); Typen/Konstanten `$lib/sdk/types/notifications.ts` (Client + Server).
  Core-Migration **0010**: `notification_pref` (nur Abweichungen), `push_subscription`, `notification_queue`; Job `core.notifications-digest` (täglich).
  Einstellungen `core.push.enabled|vapidPublicKey|vapidPrivateKey` (Schlüssel automatisch erzeugt, privat verschlüsselt). Backup: `notification_pref` in
  `core:users`, Geräte/Warteschlange nie; Reset `users` räumt alle drei; Datenauskunft enthält Einstellungen, Geräte (nur Label/Datum), Warteschlange.
- Push-Endpunkte nur von bekannten Push-Diensten (`isAllowedPushEndpoint`, SSRF). REST `/api/v1/notifications/*` nur per Session (`sessionOnly`).
- PWA: Manifest dynamisch (`src/routes/manifest.webmanifest/+server.ts`, Name aus `core.system.name`), Icons über `/branding/<datei>` (aus dem Logo, sonst `static/icons/` = Wappen), `src/service-worker.ts` (Push anzeigen, nur App-Pfade öffnen, **kein**
  Offline-Cache), CSP `worker-src`/`manifest-src 'self'`, `app.html` mit Manifest/Apple-Tags. Client `$lib/sdk/client/push.ts`.
  **Klick auf Push** (2026-10-25): SW wählt das aktive App-Fenster, fokussiert es und schickt `ep:navigate` → `sw-navigation.ts` (im Root-Layout)
  öffnet die Seite per `goto` und bestätigt per Port; sonst `client.navigate`, sonst `openWindow`. Für Kaltstarts, die auf der Startseite landen (iOS),
  merkt der SW das Ziel 60 s (Cache `ep-pending-navigation`), die App holt es beim Start per `ep:pending-navigation` ab. Manifest `launch_handler: navigate-existing`.
- UI: Profil-Reiter „Benachrichtigungen“ (`profile/_components/NotificationsTab.svelte`: Gerät aktivieren, iOS-Hinweis, Geräteliste, Regler je Typ),
  Admin-Reiter `/admin/settings/notifications`, Baustein `ui/segmented-slider`.

## Datensicherung (2026-10-20)
- Seite `/admin/backup` (Recht `core.system.backup`, Reiter Export | Import), Code in `src/lib/server/core/backup/`, Vertrag
  `src/lib/backup/contract.ts` (Client+Server: Zod-Eingaben, DTOs, Bestätigungswörter) + `core/backup/types.ts` (Format, Grenzen).
- Datei `.epbackup` = `envelope.ts` (EPBK-Header, scrypt, AES-256-GCM in 1-MiB-Chunks mit Final-Flag) um ZIP (`archive.ts`, eigener
  Streaming-Leser, Pfad-Whitelist): `backup.json` (zuerst) → `data/<schema>.<tabelle>.ndjson` (`row_to_json`, je Tabelle EIN Eintrag, Bereiche
  zusammengelegt) → `files/<objectKey>` → `checksums.json`. Secrets als Marker `{"$secret":{p,v}}` (`secrets.ts`, Zwecke `settings`,
  `module:<id>`, `better-auth`), beim Import IMMER mit dem Ziel-Schlüssel neu verschlüsselt; Quell-`APP_SECRET` nie in der Datei.
- Bereiche (`scopes.ts`): `core:users|roles|api-keys|settings|audit|api-log|jobs|ai-usage` + je Modul alle Tabellen in `mod_<id>` + `public.file`
  des Moduls. Nie: `session`, `verification`, `permission`, `module_state`, `module_migration`. `core.storage.*` nie wiederhergestellt, `core.smtp.*` nur per Option.
- Export (`export.ts`): Re-Auth (`system/maintenance.ts` `verifyReauth`), Sperre `acquireMaintenanceLock` (gemeinsam mit Reset), eine
  `repeatable read`-Transaktion (Cursor-Batches), Dateien danach (`readObjectUnchecked`), Temp-Datei → Einmal-Download (15 min).
- Import (`uploads.ts`, `restore.ts`): Upload in 8-MB-Stücken → `analyzeBackup` (Prüflauf, `compat.ts`: Core-Migrationen ⊆ Ziel, Modul-Migrationen
  = Präfix; Kontoschutz `account-guard.ts`) → `executeRestore` asynchron (`runId`, Status-Polling), Jobs pausiert. **Wiederherstellen**: Module
  `DROP SCHEMA` + `runModuleMigrations(id, tx, { only })`, Core-Bereiche löschen (Audit mit `app.audit_reset`), Einfügen in FK-Reihenfolge
  (`insert.ts`, `json_populate_recordset`, Zeilen als Rohtext → bigint verlustfrei, FK-Zyklen über nullbare Kante + späteres UPDATE), danach
  restliche Migrationen. **Zusammenführen**: nichts löschen, `ON CONFLICT DO NOTHING`, Benutzer nur neu bei unbekannter ID **und** E-Mail.
- Modul-Hook `ModuleDefinition.backup.rehash(tx, { hash, decrypt })` für schlüsselgebundene Hashes, läuft nur bei Schlüsselwechsel
  (`treasury`: IBAN-Hashes, `files`: Link-Token-Hash). **Neue `*_hash`-Spalte mit `core.crypto.forModule(id).hash` → Hook ergänzen.**
- Storage-Rohzugriff nur Core-intern: `readObjectUnchecked`, `putObjectUnchecked`, `objectExistsUnchecked`, `deleteObjectUnchecked`.
- Tests: `tests/unit/backup-*.test.ts`, `tests/integration/backup-*.test.ts`, `core-backup*.test.ts` (Seed `tests/helpers/backup-seed.ts`), E2E `admin-backup.spec.ts`.

## Logo, Favicon und App-Icons (2026-10-28)
- `core/branding.ts`: `setLogo`/`removeLogo` (Recht `core.settings.manage`, Speichern braucht `core.storage.write`; Typ + Magic Bytes, `processImage` →
  PNG ≤ 1024 px ohne Metadaten, Storage `core/branding/…`, Einstellung `core.design.logoFileId`, Audit `core.design.logo_updated|logo_removed`).
  Icons (`BRAND_ICONS`: `favicon-32`, `apple-touch-icon` 180, `icon-192/512`, `maskable-512` mit 18 % Rand) entstehen **bei Bedarf** per sharp aus dem
  Logo und werden im Prozess gecacht (keine Icon-Dateien im Storage); Füllfarbe für Apple/maskierbar = `core.design.iconBackground`.
- Öffentliche Route `/branding/<datei>` (`logo.png` + Icons; ohne Logo 302 auf `static/icons/…`), `PUBLIC_PREFIXES` in `hooks.server.ts`. `app.html` nutzt
  `%app.brand%` (Version aus Logo-ID + Hintergrund, `brandVersion`) für Cache-Busting; Service Worker zeigt `/branding/icon-192.png`.
- Root-Layout liefert `logoUrl` (Seitenleiste `AppSidebar`, mobiles Menü `Topbar`, Login) und `legal` (Datenschutz/Impressum für `LegalLinks`, das ohne Props
  `page.data.legal` nutzt). Verwaltung: `/admin/settings/design` (Dialog mit `FileField crop` quadratisch/transparent, Vorschau Favicon/iPhone/Android).
  Test `tests/integration/core-branding.test.ts`.

## Anmeldung per QR-Code (2026-10-28, Core-Migration 0011)
- `core/auth/qr-login.ts`: Tabelle `login_qr_request` (Token im QR und Browser-Geheimnis nur als SHA-256, Status pending|approved|denied|consumed,
  `scanned_at`). `createQrLogin` (30/10 min je IP, TTL 120 s, räumt Altes auf) → `inspectQrLogin` (Handy, markiert gescannt) → `decideQrLogin`
  (nur `actor.type = 'user'`, offen + nicht abgelaufen, Audit `core.auth.qr_login_approved|denied`, danach 60 s zum Einlösen) → `consumeQrLogin`
  (nur mit Geheimnis, einmalig, Audit `core.auth.login` mit `method: 'qr'`).
- Sitzung über das Better-Auth-Plugin `qr-login-plugin.ts` (`getAuth().api.qrLoginClaim`, `internalAdapter.createSession` + `setSessionCookie`, gleiche
  Datenbank-Hooks wie der Passwort-Login); HTTP-Weg `/api/auth/qr-login/claim` → 404.
- Routen: `POST/GET /login/qr` (Code anlegen + Cookie `ep_qr` httpOnly/SameSite strict/Pfad `/login/qr`, Stand), `POST /login/qr/claim`, Handy-Seite
  `/login/qr/<token>` (Login nötig; Gerät, IP, Zeit, Warnung bei anderem Netz, Knöpfe Anmelden/Ablehnen als Form-Actions). Login-Seite zeigt den QR-Code
  ab 768 px (`QrLoginPanel`, Abfrage alle 2 s, erneuert sich max. 15×). Nutzerentscheidung: nur Bestätigen-Knopf (kein Vergleichscode).
  Test `tests/integration/core-qr-login.test.ts`.
