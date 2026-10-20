---
paths:
  - "src/lib/modules/**"
  - "tests/integration/**"
---

# Fachmodule bauen

Referenzmodule: `src/lib/modules/members` (Mitglieder/Gruppen, Dokumente-Upload) und
`src/lib/modules/actions` (Aktionen, Freigaben, Kalkulation). Bei neuen Modulen deren Struktur kopieren.

## Dateistruktur
```
src/lib/modules/<id>/
├── module.ts                 defineModule({ manifest, settings?, migrations, endpoints })
├── ui.ts                     { routes: { '': () => import('./pages/X.svelte'), ':id': … } }
├── schemas.ts                API-Vertrag: Zod-Eingaben + DTO-Typen + Konstanten/Labels (von Server UND UI genutzt)
├── access.ts                 objektbezogene Zugriffsprüfung (nur wenn nötig)
├── <thema>.endpoints.ts      Export `…Endpoints: ApiEndpoint[]`
├── <thema>.service.ts        optionale Logik
├── <reine Logik>.ts          z. B. calculation.ts – ohne Server-/Svelte-Imports, in Tests und UI nutzbar
├── migrations/000N_*.sql     additiv, idempotent
└── pages/*.svelte            Seiten + Unterkomponenten
```

## Manifest und Rechte
- `id`: `[a-z][a-z0-9-]{1,30}`, nicht `core|api|auth|admin|system`. Neue Module starten **deaktiviert**; Aktivierung in `/admin/modules`.
- Berechtigungen: `<id>.<ressource>.<aktion>`, je Segment `[a-z][a-z0-9-]*` (**kein `_`**). Alle im Manifest deklarieren,
  inkl. `<id>.storage.read|write|delete` bei Datei-Uploads. Neue Rechte erhält automatisch nur die Rolle „Administrator“.
- **Jedes Recht braucht eine Beschreibung** in `manifest.permissionDescriptions` (`{ '<recht>': 'Was es erlaubt' }`, kurz, deutsch);
  wird bei jedem Start übernommen (auch für bestehende Rechte) und unter Administration → Rollen → Berechtigungen (`/admin/roles/permissions`) sowie bei API-Key-Scopes
  angezeigt. Test: `tests/integration/permission-descriptions.test.ts`.
- Navigation: `{ label, icon, path:'/modules/<id>…', permission, group?, groupIcon? }`; gleiche `group` = aufklappbare Gruppe.
  Icons stehen in `components/layout/icons.ts` (unbekannt → Box) – neue dort ergänzen.
  Eigene Einstellungsseite eines Moduls: Navigationseintrag mit `admin: true` → erscheint in der Verwaltung (Abschnitt „Module“, Befehlspalette)
  und unter Einstellungen → Module als Link; Module ohne eigene Seite bekommen dort automatisch ein Formular aus `settings`.

## Endpoints
```ts
defineEndpoint({
  method: 'GET', path: '/actions/:id',          // relativ; erreichbar unter /api/v1/modules/<id>/actions/:id
  summary: '…', tags: ['Modul: actions'],
  permission: 'actions.action.view',            // Pflicht, nie null
  params: idParams, query?, body?,               // Zod; body NUR für JSON
  handler: async ({ ctx, params, query, body, request }) => data | Response
});
```
- Array mit `as ApiEndpoint[]` abschließen (Generics sonst unhandlich).
- JSON-Antworten werden in `{ data }` verpackt; `POST` → 201. Rohe `Response` (Download) wird durchgereicht.
- **Multipart/Upload**: kein `body`-Schema; im Handler `await request.formData()`; Typ/Größe selbst prüfen.
- Objektzugriff: Basisrecht am Endpoint, danach `requireAccess(tx, ctx, id, 'read'|'edit'|'share')` (siehe `actions/access.ts`).

## Handler-Muster (wichtig)
```ts
const data = await core.database.forModule(MODULE_ID).transaction(async (tx) => {
  await requireAccess(tx, ctx, id, 'edit');
  await tx.execute(sql`UPDATE …`);
  return loadOne(tx, id);                        // nur Datenbankzugriffe innerhalb
});
const result = await build(ctx, data);           // Core-Services (users.directory, storage) DANACH
await core.audit.logFromContext(ctx, '<id>.x.updated', { target: id, metadata: { … } });
return result;
```

## Öffentliche Endpoints und Seiten (Opt-in)
- Endpoint: `permission: null` **und** `public: true`, `rateLimit` Pflicht (z. B. GET 60/60 s, POST 5/600 s), nur GET/POST,
  POST braucht `body` (JSON, strikt). Der Router erzwingt `content-type: application/json` und ein zusätzliches Gesamtlimit.
- Seite: `ui.ts` → `publicRoutes: { 'anmeldung/:token': () => import(...) }`, erreichbar unter `/p/<id>/<pfad>` ohne Login.
- Antworten identisch für „nicht vorhanden“ und „deaktiviert“ (keine Existenz verraten), keine internen Zahlen/Tokens ausgeben.
- Honeypot-Treffer wie Erfolg beantworten, aber nichts speichern. Audit mit `core.audit.log` (actor `system`), ohne personenbezogene Daten.
- Alle Texte (auch interne API-Fehler und Kommentare) mit echten Umlauten; ASCII nur in Schlüsseln, Pfaden, Dateinamen.
- Mail nach der Transaktion über `core.mail.send`, Fehler abfangen (`emailSent=false`), nie Nutzereingaben in Header.

## Daten- und Formatregeln
- Geld: Integer-Cent (`amount_cents`), Anzeige per `formatEuro` aus `$lib/components/layout/money`.
- Datum: `date` als `YYYY-MM-DD` (SQL: `to_char(col,'YYYY-MM-DD')`), Uhrzeit `HH:MM` als `text`, Zeitstempel ISO-String.
- IDs: `crypto.randomUUID()`; in Zod `z.uuid()`. Listen mit `limit/offset` (Standard 50, max 200), `total` separat zählen.
- Dateien: Pfad `<recordId>/<kind>-<uuid>-<bereinigterName>`, erst hochladen → DB aktualisieren → altes Objekt best-effort löschen.
- Sensible Felder (IBAN …): `core.crypto.forModule(id).encrypt`, in Antworten maskieren, Zugriffe auditieren.
- Schlüsselgebundene Hashes (`core.crypto.forModule(id).hash`, z. B. `iban_hash`) brauchen einen Hook `backup: { rehash }` in `defineModule`
  (Datensicherung auf neuem Server, Muster `treasury/backup.ts`); immer auch die verschlüsselte Quelle (`*_enc`) speichern.
- Mehrfachwerte (Telefone/E-Mails): eigene Tabelle mit `position`; Listen komplett ersetzen statt diffen.

## Hintergrundjobs und optionale Abhängigkeiten
- `defineModule({ jobs: [{ id, summary, schedule: 'hourly'|'daily', run(ctx) }] })`: Runner in `core/jobs` (Start in
  `hooks.server.ts`, Tick 5 min, nicht bei `JOBS_DISABLED=1`), nur für aktive Module, Systemkontext, Sperre per atomarem
  Upsert auf `job_run` (keine offene Transaktion). Rückgabe = Statusmeldung. Admin: `GET /api/v1/jobs`,
  `POST /api/v1/jobs/<modul>.<job>/run` (`core.jobs.manage`). Tests: `runDueJobs`, `runJobNow`, `setJobClockForTests`.
- `manifest.optionalDependencies` + `core.modules.useOptional(provider, caller)` → `null`, wenn der Anbieter nicht aktiv ist
  (für Rückkanäle ohne Zyklus, z. B. `actions` liest Zahlungen aus `treasury`). Harte Abhängigkeiten bleiben `dependencies`.

## Profil-Abschnitte und Standard-Rollenrechte
- `ui.ts` `profileSections: [{ id, title, order?, permission?, component: () => import(…) }]` → Karte auf `/profile`
  (Komponente bekommt `{ userId }`, lädt Daten per `apiFetch`; Auswahl/Sortierung: `selectProfileSections` in
  `$lib/sdk/client/profile-sections`). Typ `ProfileSection` in `$lib/sdk/types/module-ui`.
- `defaultRoleGrants: { Rollenname: [Rechte] }` (Manifest oder `defineModule`): Rolle per Name suchen/anlegen, Rechte
  **einmalig** je (Modul, Rolle, Recht) vergeben (Marker `role_grant_applied`, Core-Migration 0004) – entzogene Rechte
  kommen nicht zurück. Rechte müssen im Manifest stehen.

## Ämter als Vorlage mitbringen (Modul `offices`, optional)
- Manifest: `offices: [{ key, name, description?, notifications: [{ key, label, description? }] }]` (`ModuleOfficeTemplate`, Schlüssel
  `[a-z][a-z0-9-]*`) + `optionalDependencies: ['offices']`. `offices` legt das Amt **einmal** an (nur Vorlage, Marker); danach ist es ein normales,
  löschbares Amt – gelöscht wird es **nicht** neu angelegt.
- Auslösen **nach** der Transaktion: `(await core.modules.useOptional<OfficesService>('offices', MODULE_ID))?.notify(ctx, [{ module, office, event,
  subject, text, link? }])` (Typen aus `$lib/modules/offices/contract`, `import type`). Ereignisse eines Vorgangs in **einem** Aufruf (eine Mail je
  Person), keine IBAN o. Ä. im Text, Aufruf in `try/catch`. Modus (Sofort/Täglich/Aus) wählen die Inhaber*innen im Profil. Muster:
  `treasury/office-notify.ts`; Details `module-offices.md`.

## Migrationen
- Nummeriert (`0001_init.sql`, `0002_…`), in `module.ts` per `import m from './migrations/…sql?raw'` und `{ name, sql }` registrieren.
- Änderungen an bestehenden Tabellen: `ALTER TABLE … ADD COLUMN IF NOT EXISTS`; CHECK-Constraints ersetzen mit
  `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` (Namen: `<tabelle>_<spalte>_check`).
- Der Runner führt pro Modul beim Aktivieren **und** beim Start (für aktive Module) ausstehende Migrationen aus.

## UI-Seiten
- Seiten bekommen `{ params, path }` (`ModulePageProps`), **keine** Daten: alles per `apiFetch('/modules/<id>/…')` laden.
- Rechte der Seite: `page.data.permissions` (`$app/state`) + `can()`; die Durchsetzung bleibt serverseitig.
- Nach Mutationen neu laden (`loadX()`), Fehler als `ApiClientError` (`message`, `details` → Feldfehler).
- Gleiche Zod-Schemas wie der Server für die Client-Validierung (`schema.safeParse`) nutzen.

## Häufige Fallen
- `core.permissions.require(...)`/`requireAny` sind **async**: immer `await` – ohne `await` wird die Prüfung stillschweigend
  übersprungen (Sicherheitslücke, kein Fehler). Suche vor Fertigmeldung: `grep -rnE "permissions\.(require|requireAny)\(" src | grep -v await`.
- Der Router beantwortet **jedes** `POST` mit 201 (auch `reimburse`, `close`, `rotate-token`); UI nicht auf 200 prüfen.
- Berechtigung mit `_` → App-Start bricht ab (Registry-Validierung). Tests fangen das (`registerModule`).
- Core-Service in offener Modul-Transaktion → hängt auf PGlite (Tests/Demo).
- Patch-Skripte, die mehrfach laufen, duplizieren Zeilen – nach automatischen Änderungen immer `npm run check` + Diff-Blick.
- `noUncheckedIndexedAccess`: `arr[0]!` in Tests, sonst Typfehler.
