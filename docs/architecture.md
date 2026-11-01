# Architektur

## Überblick

Die Plattform ist ein **modularer Monolith**: ein SvelteKit-Prozess, eine PostgreSQL-Datenbank, klar getrennte Schichten.

```text
Browser / externe Dienste
        │
   hooks.server.ts  ── Security-Header, Session → locals, Guard
        │
   ┌────┴─────────────────┐
   │ Seiten (+page.server) │   /api/v1/[...path] → API-Router
   └────┬─────────────────┘
        │  (RequestContext)
   Core-Services  (src/lib/server/core/*)  ← Modul-SDK ($lib/sdk/server)
        │
   PostgreSQL · S3 · SMTP · OpenAI · Chromium
```

Schichten:

1. **Core-Services** (`src/lib/server/core`): auth, permissions, modules, settings, api, database, pdf, ai, storage, images, audit, jobs, search, backup, privacy, system (Reset). Liegen unter `$lib/server`, SvelteKit verhindert damit Client-Bundles.
2. **Modul-SDK** (`src/lib/sdk`): einzige erlaubte Schnittstelle für Module (`server`, `client`, `types`). ESLint (`eslint.config.js`) erlaubt Modulen nur `$lib/sdk/*`, `$lib/components/{ui,layout,forms}`, `$lib/forms`, `$lib/pdf-lists`, `$lib/utils` und fremde Verträge als `import type` (siehe [Modulentwicklung](module-development.md#erlaubte-importe)); `$lib/server/*` und `$lib/core/*` sind verboten. Zusätzlich meldet es direkte Zugriffe auf Core-Interna (`core.database.db|transaction`, `core.system`, `core.modules.enable|disable`, `core.auth.instance`, `forModule` mit fremdem Literal).
3. **Module** (`modules/<id>`): Manifest, Endpunkte, Migrationen, UI.
4. **Administrationsoberfläche** (`src/routes/(internal)/admin/…`, URLs unter `/admin`): nutzt die Core-Services direkt in `+page.server.ts` (Load/Actions) mit `locals.ctx`.
   Seitenleiste, Übersicht `/admin`, Reiter und Befehlspalette (Strg+K) kommen aus `src/lib/components/layout/admin-registry.ts`; alte URLs
   (`/users`, `/settings`, `/api-docs` …) leiten per 308 um (`src/lib/server/core/admin-redirects.ts`).

Der Core kennt keine Fachmodule: er entdeckt sie nur über das Build-Zeit-Glob `modules/*/module.ts`.

## Requestfluss

### Seiten

`handle = sequence(headers, init, authHandler, guard)` in `src/hooks.server.ts`:

1. `headers`: setzt `theme`-Klasse aus dem Cookie sowie `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, HSTS (bei HTTPS), `Cache-Control: no-store` (außer `/_app/`).
2. `init`: wartet auf `initCore()` (Migrationen, Registrierung, Sync), erzeugt Request-ID, löst für Seiten die Session über Better Auth auf und füllt `locals.ctx`/`locals.user`.
3. `authHandler`: Better-Auth-Endpunkte unter `/api/auth/*`.
4. `guard`: nicht angemeldete Benutzer werden auf `/login` umgeleitet (Ausnahmen: `/login`, `/forgot-password`, `/reset-password` und öffentliche Modulseiten `/p/…`); `/modules/<id>/…` und `/p/<id>/…` liefern 404, wenn das Modul nicht aktiv ist. Alte Verwaltungs-URLs leiten per 308 auf `/admin/…` um.

### REST API

`src/routes/api/v1/[...path]/+server.ts` → `handleApiRequest` (`core/api/router.ts`):

1. Endpunkt per Methode und Pfad im Registry finden (404/405).
2. Modulstatus prüfen (deaktiviertes Modul → `module_disabled`, 404).
3. Authentifizieren: `Authorization: Bearer epk_…` (API-Key) oder Session-Cookie.
4. CSRF: bei Session + schreibender Methode muss `Origin` mit `ORIGIN` übereinstimmen (sonst `Sec-Fetch-Site` same-origin/none).
5. Rate Limiting (je Key/Benutzer/IP und Endpunkt; Standard 120/min, anonym 30/min).
6. Autorisierung (`permission`, `authenticated`, `sessionOnly`).
7. Validierung von Params/Query/Body (Zod, Body max. 1 MB).
8. Handler → `{ "data": … }` oder fertige `Response`.
9. Protokollierung in `api_log` (ohne Request-/Response-Inhalte).

## Trennung: Registrierung, Routing, Aktivierung

| Ebene | Wann | Wo | Wirkung |
|---|---|---|---|
| **Registrierung** | Build/Start | `modules/load.ts` (`virtual:atrium-modules/server`), `registry.ts` | Modul ist im Build bekannt; Manifest wird validiert |
| **Routing** | Build | `/modules/[moduleId]/[...path]` (Catch-all), `/api/v1/modules/<id>/…` | Statische Routen, Auflösung zur Laufzeit |
| **Aktivierung** | Laufzeit | Tabelle `module_state`, `isModuleEnabled` (3 s Cache) | Entscheidet über Erreichbarkeit, Navigation und wirksame Berechtigungen |

Beim Start legt `syncModules()` fehlende `module_state`-Zeilen an (deaktiviert), gleicht Berechtigungen ab und wendet Migrationen bereits aktiver Module an.

## Entscheidungen (ADR-Kurzform)

| Entscheidung | Begründung |
|---|---|
| **SvelteKit 2 statt 3** | `better-auth` deklariert `@sveltejs/kit@^2` als Peer; Kit 3 ließ sich nicht konfliktfrei installieren. Svelte 5/Runes unverändert. |
| **Better Auth, Benutzer nur administrativ** | `disableSignUp: true`; Benutzer entstehen über `createUser`/Bootstrap. Deaktivierung über `user.active`. |
| **PGlite für Tests** | Integrationstests laufen ohne Docker gegen echtes PostgreSQL-Verhalten (inkl. Trigger). |
| **Schema pro Modul** | Jedes Modul erhält das PostgreSQL-Schema `mod_<id>`; `forModule(id).transaction` setzt `search_path` darauf. Core-Tabellen und fremde Modulschemas sind nur **unqualifiziert** nicht erreichbar – Konvention, kein Sicherheitsmechanismus (schemaqualifizierte Zugriffe wären möglich). Module sind vertrauenswürdiger Code; `forModule` nur mit eigener ID, per ESLint geprüft. |
| **Catch-all-Routing für Modul-UI** | Ein zentraler Router prüft Modulstatus und Rechte und lädt die Seite aus `ui.ts`; Module müssen keine Dateien in `routes/` ablegen. |
| **Session oder API-Key** | Gleiche Endpunkte für UI und externe Dienste; sensible Endpunkte (`/api-keys`) sind `sessionOnly`. |
| **Wirksame Rechte = Scopes ∩ Besitzerrechte** | Ein API-Key kann nie mehr als sein Besitzer; Rollenentzug wirkt sofort auf Keys. |
| **Berechtigungen deaktivierter Module zählen nicht** | `getUserPermissions` filtert auf Core und aktive Module. |
| **SHA-256 für API-Keys** | Keys haben 256 Bit Entropie; ein schneller Hash genügt und erlaubt Lookup per Index. |
| **Audit-Log append-only per DB-Trigger** | Schutz auch gegen fehlerhaften Anwendungscode. |
| **In-Memory-Rate-Limiter** | Einfach, ohne Zusatzinfrastruktur. Grenzen: pro Prozess, geht bei Neustart verloren, bei mehreren Instanzen nicht gemeinsam (siehe [Sicherheit](security.md)). |

## Erweiterbarkeit

Module liegen außerhalb von `src/` im Modulverzeichnis (Standard `modules/`, abweichend über `ATRIUM_MODULES_DIR`, siehe
`tools/modules-dir.js`). Das Vite-Plugin `tools/vite-plugin-atrium-modules.ts` bindet sie beim Build ein (`virtual:atrium-modules/server`
für die Definitionen, `virtual:atrium-modules/ui` für die Oberflächen, Tailwind-`@source` für die Klassen); Importpfad für Module ist
der Alias `$modules/<id>/…`. Das SDK (`$lib/sdk/*`) ist der stabile Vertrag. Fremde Module werden nur per `import type … from
'$modules/<id>/contract'` angesprochen (ESLint `consistent-type-imports`), damit der Build auch ohne das andere Modul gelingt.

**Geplant (2026-11-01, „Kalypzo Atrium“):** Core und Module in getrennten Repositories; Module werden im Webpanel per GitHub-Link oder
ZIP installiert, danach baut der Server die App neu. Damit ist Modulcode aus fremden Quellen möglich – er läuft mit **vollen Rechten**
im Server-Prozess (keine Sandbox); installieren dürfen nur Administrator*innen, mit fester Commit-Kennung.
