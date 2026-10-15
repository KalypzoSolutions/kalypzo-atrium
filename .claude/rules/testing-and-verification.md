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
- `tests/integration/*.test.ts` – Core/Module gegen PGlite im Speicher (kein Docker): `core.test.ts`, `members.test.ts`,
  `actions*.test.ts`, `core-directory.test.ts`.
- `tests/e2e/admin.spec.ts` – Playwright gegen Build + eigene PGlite-Instanz (`scripts/e2e-server.mjs`, Port 4173).
- `tests/helpers/db.ts` – `useTestDatabase()` (frische PGlite, Core-Migrationen).

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
- `core.storage` ist im Test nicht verfügbar (kein S3): nur `unavailable`/Validierungspfade testen.
- Tests mit `noUncheckedIndexedAccess`: `arr[0]!`.

## Unit-Tests für reine Logik
Grenzwerte (0, Maximum, Maximum+1), Rundung (aufrunden vs. runden), ungültige Eingaben (NaN, negativ, Infinity → 0),
Integer-Cent-Arithmetik. Beispiel-Rechnungen im Testkommentar nachrechnen.

## Wenn etwas hängt
Test hängt/Timeout mit PGlite → fast immer ein Core-Service-Aufruf innerhalb einer offenen Modul-Transaktion
(`core.users.directory`, `core.audit`, `core.storage`). Aufruf vor/nach die Transaktion verlegen.
