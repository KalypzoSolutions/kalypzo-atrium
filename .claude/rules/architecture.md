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
`auth`, `users.directory(ctx,{search,ids,limit})` (aktive Benutzer: id/name/email, ab 2 Zeichen, max 30),
`crypto.forModule(id)` (`encrypt/decrypt/isEncrypted`, AES-256-GCM), `permissions` (`require`, `has`, …),
`modules` (`use`, `useOptional` für `optionalDependencies`), `settings`, `api`, `database.forModule(id).transaction`, `pdf`, `ai`, `storage`
(`upload/download/remove/stat/list/signed*`; braucht `<modul>.storage.read|write|delete`), `audit.logFromContext`.
`images.process(bytes, { variants })` (sharp, nur Core): Inhalt prüfen (JPEG/PNG/WebP/AVIF/GIF, ≤ 50 MP), nach EXIF drehen,
**alle Metadaten inkl. GPS entfernen**, Varianten (WebP/JPEG/PNG) mit Maßen; Typen `ImageVariantSpec` & Co. über `$lib/sdk/server`.

## Datenbank
- Jedes Modul hat genau ein Schema `mod_<id>` (Bindestrich → Unterstrich). `forModule(id).transaction` setzt
  `SET LOCAL search_path TO "mod_<id>"` – Core-Tabellen sind dort **nicht** erreichbar (Isolation).
- Tabellen in Migrationen **unqualifiziert** anlegen; Fremdschlüssel auf Core-Tabellen gibt es nicht
  (`user_id text` ohne FK; Namen über `core.users.directory` auflösen).
- Rohe Abfragen: `tx.execute(sql\`…\`)` mit `import { sql } from 'drizzle-orm'`, Zeilen in `.rows`.
- Treiber-Unterschiede: `pg` liefert `Date`, PGlite **Strings** für `timestamptz` → immer `new Date(String(v)).toISOString()`.
- PGlite (Tests/Demo) hat **eine Sitzung**: keine verschachtelten Core-Aufrufe in offenen Transaktionen, Pool im Demo auf 1.
- Migrationen werden vom Runner in Einzel-Statements zerlegt (`modules/split-sql.ts`); `CREATE … IF NOT EXISTS`.

## Fehler und Audit
- `errors.notFound|forbidden|validation|badRequest|conflict|unauthenticated|tooLarge|unavailable` (`$lib/sdk/server`).
  HTTP: 400/403/404/409/422/401/413/503. Texte deutsch mit echten Umlauten.
- Fremde Objekte → `notFound` (nicht `forbidden`), damit Existenz nicht verraten wird.
- Audit **nach** der Transaktion: `core.audit.logFromContext(ctx, 'modul.ressource.aktion', { target, metadata })`.
  Keine personenbezogenen Details (Geburtsdatum, Allergien, E-Mail, IBAN) in `metadata`.

## Konto, Darstellung, Startseite (Core)
- E-Mail-Wechsel (`core/auth/profile.ts` `requestEmailChange`): Passwort selbst prüfen (Better Auth prüft es nicht;
  5 Fehlversuche/10 min), Hinweis an die alte Adresse, Link (1 h) an die **neue** Adresse. Neutrale Antwort auch bei belegter
  Adresse. `/verify-email` ohne Session → Redirect `/login` (keine Session über den Link, 2FA). Rate-Limit `/change-email`
  5/300 s, `/update-user` 20/300 s. Audit `core.auth.email_change_requested|email_changed` mit maskierten Adressen (`a***@domain`).
  Admin `updateUser` mit neuer Adresse: `emailVerified=true`, alle Sessions des Benutzers widerrufen, Duplikat 409.
- Profilbild: `setOwnAvatar` → Storage `core/avatars/<userId>` (braucht S3, sonst 503), `user.image=/avatar/<id>?v=…`, Auslieferung `GET /avatar/<userId>`.
- Theme: Cookie `theme` ist SSR-Quelle, `core.user.theme` (nur bei ausdrücklicher Wahl) gewinnt beim `(internal)`-Load;
  `theme.set()` schreibt zusätzlich per `POST /profile/theme`. `hooks.server.ts` ersetzt `%app.theme%`, `%app.density%`,
  `%app.style%` (`--accent-color`, nur validiertes `#rrggbb`) in `app.html`; Inline-Skript setzt `dark` bei „system“ (CSP-Nonce).
- `/` und Login ohne `redirectTo` leiten auf `core.user.startPage` (erlaubt: Dashboard, Profil, Modul-Navigation).

## Sicherheit
Security-Header und CSP aus `hooks.server.ts`/`svelte.config.js`; CSRF über SvelteKit-Origin-Check.
Öffentliche Modul-Endpoints sind **verboten** (`permission` darf nicht `null` sein) – Phase 3 führt ein
kontrolliertes Opt-in (`public: true`, Pflicht-Rate-Limit) ein. Details: `docs/security.md`.
Nutzereingaben nie als `{@html}` ausgeben; CSV-Exporte gegen Formel-Injection (`= + - @`) absichern.

## Öffentliches Multipart und Admin-Reset (2026-10-18)
- `ApiEndpoint.multipart { maxBytes ≤ 12 MB, maxFiles ≤ 10 (Standard 1) }` nur für `public: true` + POST + `body`: Router verlangt
  `multipart/form-data` + `Content-Length` (413 bei Überschreitung), Textfelder → `body`-Zod (doppelte Felder/`__proto__` → 400), Dateien → `files`.
- Reset (`core/system/reset.ts`, Recht `core.system.reset`, Seite `/admin/reset`): `listResetAreas` → `previewReset` (Token 15 min, im Prozessspeicher)
  → `exportResetData` (Passwort + TOTP bei 2FA, JSON ohne Geheimnisse) → `executeReset` (Wort `ZURÜCKSETZEN`). Bereiche: Core (`core:audit|api-log|jobs|
  ai-usage|api-keys|users|roles|settings`) + `ModuleDefinition.resetAreas` (`<modul>:<id>`, `implies` transitiv, `rebuild` = Schema neu inkl. Startdaten)
  + `resetUsers(tx, keepUserId)`. Jobs pausiert; Reihenfolge Module → Benutzer → Core → Dateien (`core.storage.purge`) → Einstellungen (Storage/SMTP/Secrets
  bleiben) → Audit (DELETE nur mit `SET LOCAL app.audit_reset = 'on'`, Migration 0005) → Eintrag `core.system.reset`.

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
- `members` ist **optional**: Modul führt `members` in `optionalDependencies`; `PrincipalProvider` (`listGroups`, `principalIdsForUser`,
  `searchMembers`, im SDK dupliziert, implementiert in `members/principals.service.ts`) via `core.modules.useOptional`. Ohne `members`
  entfallen Gruppen/Mitglieder still (Validierung → 422).
- Core: `core.roles.directory(ctx, { search, ids, limit })` (id/name, nur Anmeldung nötig, Suche ab 2 Zeichen, max. 30) und
  `core.users.roleIds(userId)`. UI: `SharePanel`/`ShareMenu`/`ShareDialog` mit `type` und `everyoneLabel` (siehe `ui-design.md`).
- Nutzer: `events` (siehe `module-events.md`). `actions` nutzt noch die Benutzer-Freigabe (`action_shares.user_id`) – Umstellung offen.

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
- **Befehlspalette** `CommandPalette` (Strg/⌘+K, Topbar-Button „Suchen“): Dashboard, Modulseiten und alle sichtbaren Verwaltungseinträge.
- Reiter **Einstellungen → Module** (`/admin/settings/modules`): generische Formulare aus `ModuleDefinition.settings` aktiver Module; Module mit eigener
  Einstellungsseite (Navigation mit `admin: true`, z. B. Kasse) erscheinen nur als Link.
- Header-Check: nur `/admin/settings/mail-preview` (E-Mail-Vorschau im iframe) bekommt `x-frame-options: SAMEORIGIN`, alles andere `DENY`.
- Neue Verwaltungsseite = Route unter `admin/` **plus** Eintrag in `admin-registry.ts` (Tests: `tests/unit/admin-registry.test.ts`, `admin-redirects.test.ts`,
  E2E `tests/e2e/admin-nav.spec.ts`).
