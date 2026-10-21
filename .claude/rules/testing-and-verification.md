# Tests und Verifikation

## Definition „fertig“
Vor jeder Fertigmeldung, in dieser Reihenfolge, alles grün:
1. `npx prettier --write <geänderte Dateien>`
2. `npm run check` → 0 Fehler, 0 Warnungen
3. `npx eslint .`
4. `npx vitest run` (Unit + Integration)
5. `npm run build`
6. bei UI/Core-Änderungen: `npx playwright test` **und** Screenshot-Prüfung (siehe `workflow.md`)
Ehrlich berichten: was **nicht** geprüft wurde (z. B. Upload mit echtem S3, Mobilansicht) ausdrücklich nennen.

## Wo liegt was
- `tests/unit/*.test.ts` – reine Funktionen (Berechnung, Parser, Schemas, Routen-Matcher).
- `tests/integration/*.test.ts` – Core/Module gegen PGlite im Speicher (kein Docker), z. B. `core.test.ts`, `members.test.ts`,
  `actions*.test.ts`, `core-directory.test.ts` und je Modul `<modul>*.test.ts`.
- `tests/e2e/*.spec.ts` (z. B. `admin.spec.ts`) – Playwright gegen Build + eigene PGlite-Instanz (`scripts/e2e-server.mjs`, Port 4173).
- `tests/helpers/db.ts` – `useTestDatabase()` (frische PGlite bzw. mit `TEST_DATABASE_URL` echtes PostgreSQL, Core-Migrationen).
- Weitere Helfer: `fake-storage.ts` (`installFakeStorage(admin)`: Fake-S3 für Integrationstests), `s3-mock.ts` (S3-Ersatz für E2E),
  `settle.ts` (wartet auf „fire and forget“-Mails), `migrations.ts` (Upgrade-Tests für Modul-Migrationen), `registration-optin.ts`,
  `backup-flow.ts`/`backup-seed.ts` (Datensicherung).

## Integrationstest für ein Modul (Muster: `tests/integration/actions.test.ts`)
```ts
await useTestDatabase();
registerCoreApi();
registerModule(myModule);
await syncModules();                       // legt Rechte UND die Administrator-Rolle an – vor bootstrapAdmin!
await bootstrapAdmin(email, pw);
admin = await ctxOf(adminId);
await enableModule(admin, '<id>');         // führt Modul-Migrationen aus
admin = await ctxOf(adminId);              // neue Modulrechte wirksam
// Rollen mit createRole(admin,{name,permissions}) – 'core.api.manage' nötig, damit der Benutzer API-Keys anlegen kann
// Benutzer mit createUser(admin,{name,email,password,roleIds}); Keys mit createApiKey(userCtx,{name,scopes})
// Aufrufe: handleApiRequest({ request: new Request(url,{headers:{authorization:`Bearer ${key}`}}), url, ip })
```
- Assertions auf Statuscodes UND `error.code`; Zugriffsmatrix (Owner / Freigabe read|edit / view-all / edit-all / fremd → 404).
- Validierung 422, Audit-Einträge vorhanden und **ohne** personenbezogene Details, Modul deaktiviert → 404.
- `core.storage` ist im Test ohne Zutun nicht verfügbar (kein S3 → `unavailable`); für Upload-Erfolgspfade `installFakeStorage(admin)`
  aus `tests/helpers/fake-storage.ts` nutzen.
- Tests mit `noUncheckedIndexedAccess`: `arr[0]!`.

## Migrationen mit Datenänderung (Pflicht, #64)
Jede Modul-Migration mit `UPDATE`/`INSERT … SELECT`/`DELETE` auf Bestandsdaten braucht einen **Upgrade-Test**:
`migrateModuleTo(id, '<N-1>')` → Altdaten per `moduleSql(id, sql\`…\`)` einfügen → `migrateModuleTo(id, '<N>')` bzw.
`migrateModuleRest(id)` → Ergebnis prüfen (Helfer `tests/helpers/migrations.ts`, Modul nur registrieren, nicht aktivieren).
Vorlagen: `module-data-migrations.test.ts` (members 0004, treasury 0002, galleries 0002), `actions-migrations.test.ts`
(0011, 0016 inkl. `legacySnapshot` über API/PDF), `files-migration.test.ts`. IDs, die später über die API laufen, als UUID anlegen.

## Job-Runner (#65)
`core-jobs-resilience.test.ts`: Retry nach `RETRY_MS`, abgelaufene Sperre vs. Heartbeat, Zeitfenster `daily`, Fehlerisolation
(Fehler in `finish()` per Trigger auf `job_run` erzwungen). Uhr per `setJobClockForTests`, Heartbeat per `setJobHeartbeatForTests`.

## HTTP-Schicht (#63)
`tests/unit/hooks-server.test.ts` ruft `handle` aus `hooks.server.ts` mit gestubbtem `RequestEvent` auf (Core-Module gemockt);
Backup-Route-Guards in `tests/unit/admin-backup-http.test.ts`; Core-REST-Lücken in `tests/integration/core-rest-endpoints.test.ts`.

## Echtes PostgreSQL und Nebenläufigkeit (#60)
- `TEST_DATABASE_URL=postgres://…` → `useTestDatabase()` nutzt den `pg`-Treiber, je Testdatei eigene DB `ept_*` (gelöscht in `close()`),
  Pool `TEST_DATABASE_POOL_MAX` (Standard 4); `TEST_DATABASE_ISOLATION=reset` leert stattdessen die angegebene DB (`--no-file-parallelism`).
  Ohne Variable: PGlite wie bisher. Lokal: Wegwerf-Container auf Port **55432** (nie 4300/54330/9100), Details `docs/database.md`.
- `tests/integration/pg-concurrency.test.ts` (nur mit URL): Rechnungs-/Bestellnummern, Kontingent, Mahnlauf, Modul-Migrationen,
  `withMigrationLock` (nur echter Server, `isRealPostgres()`), Job-Claim, Treiberwerte. CI-Job `postgres`.
- Neue Advisory-Sperre → Fall in `pg-concurrency.test.ts` ergänzen; Gegenprobe „Sperre raus → rot“ einmal von Hand.
- `pg` liefert `int8` als String: in Mappern immer `Number()`/`num()` (PGlite verdeckt das).

## Keine festen Wartezeiten (#75)
- „Fire and forget“-Mails: `await settleMails()` (`tests/helpers/settle.ts`, nutzt `mailIdleForTests` aus `core/mail.ts`) statt `setTimeout`.
- Sonstiges Asynchrones: `vi.waitFor(() => expect(…), { timeout: 2000 })` bzw. Deferred-Promises; in E2E `expect.poll`/`toPass`/Zustände.
- Erlaubt nur mit Begründung im Kommentar: Beobachtungsfenster für Negativ-Nachweise ohne Ereignis (E2E `actions-list.spec.ts`
  Effekt-Endlosschleife) und gewollte Verzögerung zum Nachstellen eines Wettlaufs (`treasury-sync-readonly.test.ts`).
- Offen: `core-jobs-resilience.test.ts` (Heartbeat, 80 ms) – Team Jobs.
- E2E: kein stilles Wiederverwenden alter Server (`E2E_REUSE_SERVER=1` nur bewusst), Browser + Spec-Runner in Europe/Berlin
  (`timezoneId`, `TZ`), Server in UTC wie im Container. Offen: eigenes Build-Verzeichnis für E2E (Team Build), `nth()`-Auswahl in
  `annual-fee.spec.ts`/`pdf-lists.spec.ts` (#62).

## Außendienste (S3, SMTP, PDF) – Vorschlag `test:external` (#75, nicht umgesetzt)
Heute durchgängig ersetzt (`fake-storage.ts`, `s3-mock.ts`, `setMailTransportForTests`, `setPdfRendererForTests`). Vorschlag für einen
Nightly-Lauf mit echten Diensten (Docker, Ports ≠ Demo):
- Dienste wie `docker-compose.demo.yml`, aber eigene Ports: MinIO (`bitnamilegacy/minio`, :59100), Mailpit (`axllent/mailpit`, SMTP :51025,
  API :58025), Chromium über `npx playwright install chromium`; per `services:` im CI-Job oder `testcontainers` (npm, startet je Lauf
  Wegwerf-Container und liefert Host/Port).
- `tests/external/*.test.ts` + `npm run test:external` (eigene Vitest-Konfiguration, nicht im Standardlauf): Storage-Einstellungen auf
  MinIO setzen → Upload/Download/Signed URL/Löschen; MinIO stoppen → kontrolliert **503**; `setSmtp…` auf Mailpit → eine Mail senden und
  über die Mailpit-API (`GET /api/v1/messages`) prüfen, falsches Passwort → Fehler gezählt; ein Briefvorlagen-PDF mit echtem Chromium
  rendern (Seitenzahl, Schrift Carlito eingebettet).

## Unit-Tests für reine Logik
Grenzwerte (0, Maximum, Maximum+1), Rundung (aufrunden vs. runden), ungültige Eingaben (NaN, negativ, Infinity → 0),
Integer-Cent-Arithmetik. Beispiel-Rechnungen im Testkommentar nachrechnen.

## Wenn etwas hängt
Test hängt/Timeout mit PGlite → fast immer ein Core-Service-Aufruf innerhalb einer offenen Modul-Transaktion
(`core.users.directory`, `core.audit`, `core.storage`). Aufruf vor/nach die Transaktion verlegen.
