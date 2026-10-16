# Core-Services

Serverseitiger Zugriff erfolgt über das `core`-Objekt:

```ts
import { core } from '$lib/sdk/server';
```

Alle Operationen erhalten einen **RequestContext** und erzwingen Berechtigungen selbst.

## RequestContext

```ts
interface RequestContext {
  actor: { type: 'user' | 'api_key' | 'system'; id: string | null; name: string };
  userId: string | null;                 // bei API-Keys: Besitzer
  permissions: ReadonlySet<string>;      // wirksame Rechte
  ip: string | null;
  requestId: string;
}
```

- In Seiten: `locals.ctx`. In API-Handlern: Argument `ctx`.
- `core.auth.systemContext()` erzeugt einen Systemkontext (umgeht Berechtigungsprüfungen; nur für Hintergrundaufgaben).
- Der Kontext ist ein Schnappschuss; Rechteänderungen wirken ab der nächsten Anfrage.

## Fehler

`CoreError` (`code`, `status`, `message`, `details`). Codes: `bad_request` 400, `validation_failed` 422, `unauthenticated` 401, `forbidden` 403, `not_found` 404, `method_not_allowed` 405, `conflict` 409, `rate_limited` 429, `module_disabled` 404, `payload_too_large` 413, `unavailable` 503, `internal_error` 500. Erzeugung über `errors.forbidden(...)` etc.; Prüfung mit `isCoreError`. Der API-Router bildet sie auf das [einheitliche Fehlerformat](api.md#fehlerformat) ab.

## core.auth

| Funktion | Beschreibung |
|---|---|
| `instance()` | Better-Auth-Instanz (`api.signInEmail`, `listSessions`, …) |
| `resolveSession(headers, meta?)` | `{ ctx, user, sessionId } \| null`; deaktivierte Benutzer → `null` |
| `resolveApiKey(rawKey, meta?)` | `{ ctx, keyId } \| null`; prüft Hash, Widerruf, Ablauf |
| `contextForUser(userId, meta?)` | Kontext für einen aktiven Benutzer |
| `systemContext(name?)`, `anonymousContext(ip?)` | Spezialkontexte |

## core.permissions

```ts
await core.permissions.require(ctx, 'core.users.create'); // wirft unauthenticated/forbidden
core.permissions.has(ctx, 'core.users.view');             // boolean, synchron
await core.permissions.requireAny(ctx, ['a.b.c', 'd.e.f']);
core.permissions.assertCanGrant(ctx, ['core.users.view']); // Schutz vor Rechteausweitung
await core.permissions.forUser(userId);                    // Set<string>
await core.permissions.list();                             // registrierte Berechtigungen
```

## core.modules

`list()`, `isEnabled(id)`, `assertEnabled(id)`, `enable(ctx, id)`, `disable(ctx, id)`, `navigationFor(ctx)`, `registered()`. `enable` prüft Abhängigkeiten, führt Modulmigrationen aus und schreibt ein Audit-Event; `disable` scheitert, solange aktive Module abhängen.

## core.settings

```ts
const name = await core.settings.get<string>('core.system.name');
await core.settings.set(ctx, 'core.design.accentColor', '#2563eb'); // validiert (Zod), auditiert
const view = await core.settings.listPublic({ group: 'smtp' });      // Secrets: value=null, isSet=true|false
```

- Globale Einstellungen erfordern `core.settings.manage`; benutzerspezifische (`scope: 'user'`) nur für den eigenen Benutzer.
- Secrets (`secret: true`) werden mit AES-256-GCM verschlüsselt gespeichert; leerer Wert beim Setzen behält den alten, `null` löscht.
- Module registrieren Einstellungen im Manifest-Umfeld (`ModuleDefinition.settings`); Schlüssel müssen mit `<id>.` beginnen.

## core.api

`defineEndpoint(...)` (typisierte Endpunktdefinition), `keys.create/list/revoke`. Siehe [API](api.md).

## core.database

```ts
const mdb = core.database.forModule('members');
await mdb.transaction(async (tx) => {
  // search_path = "mod_members"; tx ist eine Drizzle-Transaktion
});
core.database.db();            // Core-intern: gesamte Datenbank
core.database.transaction(fn); // Core-intern
```

Module verwenden ausschließlich `forModule(<eigene id>)`.

## core.pdf

```ts
const pdf = await core.pdf.generate(ctx, {
  title: 'Mitgliederliste',
  content: [
    { type: 'heading', text: 'Übersicht', level: 1 },
    { type: 'table', columns: ['Name', 'Ort'], rows: [['A', 'B']] }
  ],
  format: 'A4', orientation: 'portrait',
  module: 'members', store: { path: 'documents/liste.pdf' } // optional
});
// pdf.buffer, pdf.fileName, pdf.stored?
```

- Blocktypen: `heading`, `paragraph`, `list`, `table`, `image`, `pageBreak`. Alles wird HTML-escaped; es gibt keinen Roh-HTML-Block.
- `image`: nur `data:image/png|jpeg;base64,…` (≤ 2 MB), `widthMm` 5–150 – z. B. QR-Code aus `core.qr.dataUrl(text)`.
- `core.pdf.generateMany(ctx, inputs[], title)` erzeugt mehrere Dokumente (je eigene Vorlage/Adresse) nacheinander und fügt sie zu **einem** PDF zusammen (max. 200); `core.pdf.merge(buffers[])` fügt fertige PDFs zusammen. `core.app.origin()` liefert die öffentliche Basis-URL (`ORIGIN`).
- Templates: `default`, `compact`; eigene über `registerTemplate`. Header (Logo/Organisation/Kopfzeile) und Footer (Datum, Fußzeile, „Seite X von Y“) sind unabhängig vom Inhalt.
- Defaults (Format, Ausrichtung, Ränder, Texte, Logo) aus `core.pdf.*`.
- Chromium läuft ohne JavaScript, externe Requests werden blockiert.
- `generate` verlangt nur eine Identität; die Berechtigung `core.pdf.generate` wird im API-Endpunkt geprüft.

### Briefvorlagen

Vorlagen mit festem Seitenlayout (Briefkopf, Falzmarken, Adressfeld, Fußzeile) liegen **im Code**, nicht in der DB:

- `src/lib/server/core/pdf/templates/` – eine Datei je Vorlage, `export default` ein `PdfTemplate`; wird automatisch registriert.
- `src/lib/server/core/pdf/parts/` – wiederverwendbare Bausteine (`briefkopf`, `falzmarken`, `adressfeld`, `fusszeile`).
- `src/lib/server/core/pdf/assets/` – Schriften (Carlito, OFL, metrisch kompatibel zu Calibri) und Bilder; alles wird eingebettet, keine externen Requests.
- Neue `PdfTemplate`-Felder: `description`, `source` (Anzeige), `page` (Format/Ränder, schaltet Chromium-Kopf/-Fuß ab), `overlay` (absolut positionierte Seitenelemente), `parts` (Bestandteile mit Position/Größe in mm).
- `core.pdf.generate` nimmt zusätzlich `recipient: string[]` (Adresszeilen für das Adressfeld; werden escaped).
- Mitgelieferte Vorlagen: `stamm-briefkopf` (Briefkopf für Abrechnungen) und `stamm-brief` (mit Adressfeld und Falzmarken).
- Admin-Ansicht „PDF-Vorlagen“: Vorlagen mit Seitenvorschau (`GET /pdf/preview?template=<id>[&only=<teil>]`, Recht `core.pdf.manage`) – nur Ansicht.
- Die Overlay-Elemente nutzen `position: fixed`; Chromium wiederholt sie im Druck auf jeder Seite.

**Neue Vorlage hinzufügen**

1. Referenz (Bild/Maße) nach `docs/reference/` legen.
2. Bausteine aus `parts/` verwenden oder neu anlegen (Maße in mm).
3. Datei `templates/<id>.ts` mit `export default` eines `PdfTemplate` (`id`, `label`, `description`, `source`, `page`, `overlay`, `parts`).
4. Vorschau in der Admin-Ansicht prüfen und gegen das Referenzbild abgleichen (Screenshot, `pdftotext -bbox`).
5. Test ergänzen und `npm run check`, `npx eslint .`, `npx vitest run` ausführen.

## Modul-Dienste (`ModuleDefinition.provides`, `core.modules.use`)

Ein Modul kann abhängigen Modulen typisierte Funktionen anbieten: `defineModule({ …, provides: { … } })`, Vertrag als reine Typen in `src/lib/modules/<id>/contract.ts`.
Aufruf: `await core.modules.use<MembersService>('members', 'actions')` – prüft, dass das aufrufende Modul den Anbieter in `manifest.dependencies` führt und der Anbieter aktiv ist
(sonst `module_disabled`). Aufruf **nie** innerhalb einer offenen Modul-Transaktion. Beispiel: `actions` → `members` (Anmeldung mit Mitglied).

Optionale Abhängigkeit: `manifest.optionalDependencies: ['<anbieter>']` und `await core.modules.useOptional<T>('<anbieter>', '<aufrufer>')`
liefern `null`, wenn der Anbieter nicht registriert oder nicht aktiv ist – ohne Aktivierungsreihenfolge und ohne Zyklus-Prüfung.
Beispiel: `actions` liest über `TreasuryService` die tatsächlich eingegangenen Beiträge aus der Kasse (`treasury` hängt seinerseits hart von `actions` ab).

## Hintergrundjobs (`ModuleDefinition.jobs`, `core/jobs`)

`defineModule({ …, jobs: [{ id: 'reminders', summary: '…', schedule: 'hourly' | 'daily', run: async (ctx) => 'Statusmeldung' }] })`.
Der Runner startet nach der Initialisierung in `hooks.server.ts` (nicht beim Build, nicht mit `JOBS_DISABLED=1`), prüft alle 5 Minuten
und führt fällige Jobs **aktiver** Module mit Systemkontext aus (`hourly` ≥ 55 min, `daily` ≥ 23 h seit dem letzten Start).
Die Sperre ist ein atomares Upsert auf `job_run` – mehrere Instanzen laufen nicht doppelt, und es bleibt keine Transaktion offen
(PGlite). Ein Lauf ohne Abschluss gilt nach 2 h als abgebrochen. Fehler werden in `job_run.last_status/last_message` protokolliert.
API: `GET /api/v1/jobs` (Liste mit letztem Lauf), `POST /api/v1/jobs/<modul>.<job>/run` (sofort, Recht `core.jobs.manage`, auditiert
als `core.job.triggered`). Tests: `runDueJobs()`, `runJobNow(ctx, key)`, `setJobClockForTests(fn)`.

## core.mail und E-Mail-Layout

`core.mail.send({ to, subject, text, html? })` sendet über SMTP. Jede Mail (auch Passwort-Reset, Test-Mail) bekommt das
**Stamm-Layout** (`src/lib/server/core/mail-layout.ts`, abgeleitet vom Stamm-Briefkopf der PDF-Vorlagen):
Kopf mit Lilie, Vereinsname und Wappen, Inhalt, Signatur, Fußzeile mit Vereinsnachweis.

- `text` wird escaped zu Absätzen/Links; `html` (optional) ist ein **Inhaltsfragment** und wird ins Layout gesetzt.
  Die Textfassung enthält Signatur und Fußzeile ebenfalls.
- Bilder (`mail-assets/`, verkleinert) gehen als CID-Anhänge mit, nicht als `data:`-URL.
- Verwaltung unter **Systemeinstellungen → E-Mail-Layout** (`core.mail.layoutEnabled`, `core.mail.showEmblem`,
  `core.mail.signature`, `core.mail.footerText`; Akzentfarbe aus `core.design.accentColor`) mit Live-Vorschau
  (`GET /settings/mail-preview`, Recht `core.settings.view`).
- Intern (`sendMail` in `core/mail.ts`) lässt sich das Layout per `layout: false` abschalten; Module nutzen es immer.

## Konten per Code anlegen (`core.users.registerWithRole`)

`core.users.registerWithRole({ name, email, password, roleName })` legt ein Konto **ohne Berechtigungsprüfung** an
(Passwort 12–128 Zeichen, Rolle per Name, wird ohne Rechte angelegt, falls sie fehlt; `409` bei vorhandener E-Mail).
Nur aus kontrollierten öffentlichen Pfaden aufrufen, die selbst einen Nachweis verlangen (z. B. Verknüpfungscode im Modul `members`).

## core.ai

```ts
const r = await core.ai.generate(ctx, { module: 'members', prompt: '…', model: 'configured-default' });
// r.text, r.usage = { model, inputTokens, outputTokens, estimatedCostUsd }
const obj = await core.ai.generateJson(ctx, { module, prompt, schema: zodSchema });
for await (const chunk of core.ai.stream(ctx, { module, prompt })) { /* Text-Deltas */ }
await core.ai.usage(ctx, { from, to }); // Verbrauch je Modul/Modell (core.ai.view)
```

- Berechtigung: `<module>.ai.use` oder `core.ai.manage`; zusätzlich Modul-/Modell-Allowlist, globales Rate Limit, monatliche Token-/Kostenlimits je Modul.
- Es werden nur Zähler gespeichert (`ai_usage`), keine Prompts oder Antworten.
- `files: [{ module, path }]` liest Dateien über den Storage-Service mit demselben Kontext; unterstützt Bilder, Text/CSV/JSON und PDFs.

## core.storage

| Funktion | Beschreibung |
|---|---|
| `upload(ctx, { module, path, file, contentType?, name? })` | Ablegen/Ersetzen; Multipart ab 8 MB |
| `download(ctx, { module, path })` | `{ buffer, file }` |
| `remove`, `stat`, `list(ctx, { module, prefix? })` | `list` liefert `{ files, folders }` (virtuelle Ordner) |
| `signedUploadUrl` / `confirmUpload` | Direkter Upload zum Bucket, danach Bestätigung |
| `signedDownloadUrl` | Zeitlich begrenzte URL |
| `usage(ctx)` | Speicherverbrauch je Modul (`core.storage.manage`) |

Zugriff: `<module>.storage.read|write|delete` oder `core.storage.manage`; für Modul `core` entsprechend `core.storage.*`. Grenzen: `core.storage.maxFileSizeMb`, Content-Type-Allowlist (HTML/SVG nur bei expliziter Freigabe). Metadaten liegen in `file`, Objekte unter einem nicht ableitbaren Schlüssel im Bucket.

## core.audit

```ts
await core.audit.log({ action: 'members.user.created', actor: ctx.actor, metadata: { targetId } });
await core.audit.logFromContext(ctx, 'members.user.created', { target: id, metadata: {} });
await core.audit.list({ action: 'core.', search: 'x', limit: 50, offset: 0 });
```

Metadaten werden bereinigt: Schlüssel, die auf `password`, `secret`, `token`, `apiKey`, `authorization`, `cookie`, `credential`, `hash` passen, werden durch `[redacted]` ersetzt; Strings werden gekürzt, Tiefe begrenzt.
