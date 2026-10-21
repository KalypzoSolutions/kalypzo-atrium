# Architektur

## Schichten
- `src/lib/server/core/**` – Core-Implementierung (nur Server). Zentraler Einstieg: `core` aus `src/lib/server/core/index.ts`.
- `src/lib/sdk/{server,client,types}` – **öffentliche** Schnittstelle für Module (`defineModule`, `defineEndpoint`, `core`, `errors`, `apiFetch`, `can`, Typen).
- `src/lib/components/{ui,layout}` – UI-Bausteine (ui = shadcn/bits-ui-Wrapper, layout = fachliche Bausteine).
- `src/lib/modules/<id>/` – Fachmodule (`module.ts`, `ui.ts`, `schemas.ts`, `migrations/*.sql`, Endpoints, `pages/`).
- `src/routes/**` – SvelteKit: `login/…` öffentlich, `(internal)/…` hinter Login, `api/v1/[...path]` zentraler REST-Router.
- `drizzle/` – Core-Migrationen. Modul-Migrationen liegen im Modul (`migrations/*.sql?raw`).

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
`modules` (`use`, `useOptional` für `optionalDependencies`), `settings`, `api`, `database.forModule(id).transaction`, `pdf`, `ai`, `storage`
(`upload/download/remove/stat/list/signed*`; braucht `<modul>.storage.read|write|delete` – internes Recht für Modul-Endpunkte mit Objektprüfung;
die generische REST-API `/api/v1/storage/*` verlangt `core.storage.manage`, 403 vor 503), `audit.logFromContext`.
Seit 2026-10-20 (#23/#24): `storage.downloadStream` (Inhalt als `ReadableStream`, `file.size` = Länge – für Bild-/Datei-Auslieferung),
`storage.removeMany(ctx, { module, paths })` (S3 `DeleteObjects` à 1000, Rückfall Einzel-Löschung ×8, ein Audit `core.storage.files_deleted`,
`{ removed, missing, failed }`, Metadaten fehlgeschlagener Objekte bleiben). Storage-Konfiguration 10 s gecacht, `setSettings` mit `core.storage.*`
invalidiert sofort (`invalidateStorageConfigCache`, `storage/config-cache.ts`). `getUserPermissions` nutzt den Modulstatus-Cache (3 s),
`principalKeysFor` ist je Kontextobjekt + Modul memoisiert (WeakMap, 5 s). Bild-Endpunkte: `IMAGE_RATE_LIMIT` (1200/60 s) aus `$lib/sdk/server`.
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
- **Zugriffsbaustein** (#35, `$lib/sdk/server/share-access.ts`): `createShareAccess({ table, shareTable, fk, ownerColumn?, perms: { viewAll, editAll },
  readIf?: { column, equals }, notFoundText, forbiddenText })` → `canEditAll`, `canViewAll`, `resolveAccess`, `requireAccess` (404/403), `visibleFilter(ctx, keys,
  alias)`, `accessForMany`, `loadShares`, `replaceShares`. `events`/`galleries` (`readIf` = öffentlich) haben in `access.ts` nur noch Konfiguration; `files`
  (Ordnervererbung) nutzt die Bausteine `shareLevelOn`, `loadObjectShares`, `replaceObjectShares` mit `NODE_SHARES`. Neue Module (z. B. `actions`-Umstellung)
  bauen darauf auf. Test `tests/integration/share-access.test.ts` (Zugriffsmatrix mit Testtabelle).
- Nutzer: `events` (siehe `module-events.md`), `galleries`, `files`. `actions` nutzt noch die Benutzer-Freigabe (`action_shares.user_id`) – Umstellung offen.

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
- Reiter **Einstellungen → Module** (`/admin/settings/modules`): generische Formulare aus `ModuleDefinition.settings` aktiver Module; Module mit eigener
  Einstellungsseite (Navigation mit `admin: true`, z. B. Kasse) erscheinen nur als Link.
- Header-Check: nur `/admin/settings/mail-preview` (E-Mail-Vorschau im iframe) bekommt `x-frame-options: SAMEORIGIN`, alles andere `DENY`.
- Neue Verwaltungsseite = Route unter `admin/` **plus** Eintrag in `admin-registry.ts` (Tests: `tests/unit/admin-registry.test.ts`, `admin-redirects.test.ts`,
  E2E `tests/e2e/admin-nav.spec.ts`).

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
