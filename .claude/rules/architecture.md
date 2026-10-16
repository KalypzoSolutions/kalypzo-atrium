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
  HTTP: 400/403/404/409/422/401/413/503. Texte deutsch, ASCII-transliteriert.
- Fremde Objekte → `notFound` (nicht `forbidden`), damit Existenz nicht verraten wird.
- Audit **nach** der Transaktion: `core.audit.logFromContext(ctx, 'modul.ressource.aktion', { target, metadata })`.
  Keine personenbezogenen Details (Geburtsdatum, Allergien, E-Mail, IBAN) in `metadata`.

## Sicherheit
Security-Header und CSP aus `hooks.server.ts`/`svelte.config.js`; CSRF über SvelteKit-Origin-Check.
Öffentliche Modul-Endpoints sind **verboten** (`permission` darf nicht `null` sein) – Phase 3 führt ein
kontrolliertes Opt-in (`public: true`, Pflicht-Rate-Limit) ein. Details: `docs/security.md`.
Nutzereingaben nie als `{@html}` ausgeben; CSV-Exporte gegen Formel-Injection (`= + - @`) absichern.
