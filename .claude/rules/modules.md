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

## Erlaubte Importe (ESLint je Modul, #44/#47)
- Erlaubt: eigene Moduldateien, `$lib/sdk/*`, `$lib/components/{ui,layout,forms}`, `$lib/forms`, `$lib/pdf-lists` (inkl.
  `$lib/pdf-lists/member-columns` = Mitglieder-Spaltenkatalog), `$lib/utils`. Fremde Module **nur** `import type … from '$lib/modules/<id>/contract'`
  (Laufzeit über `core.modules.use|useOptional`); andere Fremddateien und relative Pfade `../<anderes-modul>/…` → ESLint-Fehler.
- Gemeinsame reine Hilfen in eine dieser Bibliotheken legen (oder als Dienst in den Vertrag), nie aus einem anderen Modul importieren.
- `no-restricted-syntax`: `core.database.db`, `core.system.*`, `core.modules.enable|disable`, `core.auth.instance`, `forModule('<fremde-id>')` verboten.
- Offene Ausnahmen: `OPEN_BOUNDARY_EXCEPTIONS` in `eslint.config.js` (mit Grund, beim Beheben löschen). Test: `tests/unit/module-boundaries.test.ts`.
- Details: `docs/module-development.md` → „Erlaubte Importe“.

## Manifest und Rechte
- `id`: `[a-z][a-z0-9-]{1,30}`, nicht `core|api|auth|admin|system`. Neue Module starten **deaktiviert**; Aktivierung in `/admin/modules`.
- Berechtigungen: `<id>.<ressource>.<aktion>`, je Segment `[a-z][a-z0-9-]*` (**kein `_`**). Alle im Manifest deklarieren,
  inkl. `<id>.storage.read|write|delete` bei Datei-Uploads. Neue Rechte erhält automatisch nur die Rolle „Administrator“.
- **Jedes Recht braucht eine Beschreibung** in `manifest.permissionDescriptions` (`{ '<recht>': 'Was es erlaubt' }`, kurz, deutsch);
  wird bei jedem Start übernommen (auch für bestehende Rechte) und unter Administration → Rollen → Berechtigungen (`/admin/roles/permissions`) sowie bei API-Key-Scopes
  angezeigt. Test: `tests/integration/permission-descriptions.test.ts`.
- Navigation: `{ label, icon, path:'/modules/<id>…', permission, anyPermission?, order?, admin?, settingsPage?, group?, groupIcon? }`.
  Seitenleiste = **flache Liste**, sortiert nach `order` (Nutzerentscheidung 2026-10-21; Werte siehe `docs/module-development.md`: Termine 10 … Kasse 100,
  ohne Angabe 1000). Konfigurationsseiten mit `admin: true` in die Administration, nicht ins Hauptmenü. `group`/`groupIcon` (aufklappbare Gruppe,
  modulübergreifend) existiert noch, Fachmodule nutzen es nicht.
  `anyPermission` (eines genügt, ersetzt `permission`) für Seiten mit eingeschränktem Modus (z. B. `members` für Gruppenleitungen).
  Icons stehen in `components/layout/icons.ts` (unbekannt → Box) – neue dort ergänzen.
  Eintrag mit `admin: true` → erscheint in der Verwaltung (Abschnitt „Module“, Befehlspalette; mehrere Seiten eines Moduls heißen nach ihrem Label).
  Nur mit zusätzlich `settingsPage: true` ersetzt er unter Einstellungen → Module das automatische Formular aus `settings` durch einen Link (Kasse).
- **Manifest-Verweise werden beim Start geprüft** (`core/modules/validate.ts` `validateModuleReferences`, aus `syncModules`; #76): Rechte in
  `defaultRoleGrants` müssen im **eigenen** Manifest stehen; `navigation[].permission` und `search.permission|anyPermission` müssen bekannte Rechte
  (Core oder ein registriertes Modul) sein; `resetAreas`-IDs `[a-z][a-z0-9-]*`, eindeutig, nicht leer; `implies` = `<modul>:<bereich>` und bei registriertem
  Zielmodul ein existierender Bereich. Sonst wirft der Start. Zyklen über `optionalDependencies` (z. B. `actions` ⇄ `treasury`) → einmalige `console.warn`.
  Test: `tests/unit/module-validate.test.ts`.
- **Audit-Aktionen** wie Rechte mit Bindestrich (`orders.order.handed-out`); bestehende Namen mit Unterstrich (`treasury.invoice.marked_paid`,
  `actions.accounting.club_paid` …) bleiben wegen der Historie – Filter müssen beide Schreibweisen kennen.

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
- Liste mit `as ApiEndpoint[]` abschließen oder – wenn Enum-Parameter/Body-Typen nicht zur Standard-Generik passen – als
  `export const xEndpoints: AnyApiEndpoint[] = [defineEndpoint({…}), …];` deklarieren (`$lib/sdk/server`). **Kein** `as unknown as ApiEndpoint[]` (#46).
- JSON-Antworten werden in `{ data }` verpackt; `POST` → 201. Rohe `Response` (Download) wird durchgereicht.
- **Multipart/Upload** (#33): kein `body`-Schema; Einzeldatei `await readUpload(request, { maxBytes, allowedTypes, typesLabel, fallbackName })`
  (`$lib/sdk/server`) → `{ bytes, contentType, name, size }`; Mehrfeld-Formular `readFormData(request)` + `takeUpload(form, rules)` (`required: false`
  = optional), schon gelesene Bytes `checkUploadBytes`. Einheitlich: kaputter Body 400, Feld fehlt/leer/Typ/Inhalt ≠ Typ (Magic Bytes, `sniff`
  Standard an) **422** Pfad `file`, zu groß **413**. Bilder: `sniff: false` + `detectMissingType` (Inhalt prüft `core.images.process`, 400).
  Speicherpfad-Name `safeFileName(name)` (`$lib/sdk/file-names`, auch über `$lib/sdk/server`), Header `contentDisposition`/`secureFileResponse`.
- **„Heute“ und Datum** (#32): nur `todayBerlin()` aus `$lib/sdk/dates` (Server und Browser, Europe/Berlin), nie `new Date().toISOString().slice(0, 10)`
  oder Lokalzeit; dazu `addDays`, `daysBetween`, `isRealDate`, `formatDateDe`, `formatDateTimeDe`, `ageFromBirthDate`. Tests: `setTodayForTests(d|null)`
  (einziger Override, gilt für alle Module) bzw. `vi.setSystemTime`. In SQL `${todayBerlin()}::date` statt `CURRENT_DATE` (DB läuft in UTC).
- **CSV/Geld** (#34): CSV nur über `$lib/sdk/csv` (`csvDocument`, `csvFromRecords`, `csvCell`; BOM, `;`, CRLF, Formelschutz für **alle** Texte mit
  `= + - @ Tab CR`), Beträge als `csvCents(cents)` (Zahl „-1234,50“). Anzeige/PDF/Mail `formatEuro` (`$lib/components/layout/money`, „1.234,50 €“ mit
  geschütztem Leerzeichen), maschinenlesbar `centsPlain`. Kein eigenes `toFixed(2).replace`.
- Objektzugriff: Basisrecht am Endpoint, danach `requireAccess(tx, ctx, id, 'read'|'edit'|'share')` (siehe `actions/access.ts`). Objekte mit
  Principal-Freigaben (`<obj>_shares`): **nicht** selbst schreiben, sondern `createShareAccess(...)` aus `$lib/sdk/server` (Muster `events/access.ts`,
  Details `architecture.md` → „Freigabe an Principals“).
- DB-Grundhelfer (`moduleDb`, `rowsOf`, `inList`, `toIso`, `str`, `num`, `type Row`) und Namen (`core.users.byIds` + `userLabel`) nur aus dem SDK,
  keine lokalen Kopien. IBAN-Prüfung/-Maske nur `$lib/sdk/iban` (`isValidIban`, `normalizeIban`, `formatIban`, `ibanLast`, `maskFromLast`, `maskIbanTail`).

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
- `defineModule({ jobs: [{ id, summary, schedule: 'hourly'|'daily'|{ everyMinutes: 1–60 }, run(ctx) }] })`: Runner in `core/jobs` (Start in
  `hooks.server.ts`, Tick **1 min** (seit 2026-10-22), nicht bei `JOBS_DISABLED=1`), nur für aktive Module, Systemkontext, Sperre per atomarem
  Upsert auf `job_run` (keine offene Transaktion). Rückgabe = Statusmeldung. Admin: `GET /api/v1/jobs`,
  `POST /api/v1/jobs/<modul>.<job>/run` (`core.jobs.manage`). Tests: `runDueJobs`, `runJobNow`, `setJobClockForTests`.
  `daily` = einmal je Tag im Fenster `JOBS_DAILY_WINDOW` (Standard `6-20`, Europe/Berlin), nach Fehler neuer Versuch nach 15 min,
  Heartbeat jede Minute, abgebrochen erst nach 10 min ohne Heartbeat. Jobs trotzdem **idempotent** bauen (Abbruch mitten im Lauf möglich).
- `manifest.optionalDependencies` + `core.modules.useOptional(provider, caller)` → `null`, wenn der Anbieter nicht aktiv ist
  (für Rückkanäle ohne Zyklus, z. B. `actions` liest Zahlungen aus `treasury`). Harte Abhängigkeiten bleiben `dependencies`.
  Andere Fehler von `useOptional` (fehlende Deklaration) **nicht** per `try { … } catch { return null }` schlucken (#46, Muster `orders/db.ts`).
- `provides` mit `satisfies <Vertrag aus contract.ts>` angeben (`ModuleDefinition.provides?: object`), **nie** `as unknown as Record<…>` – sonst fällt eine
  fehlende Methode erst zur Laufzeit auf. Vertrag des Principal-Dienstes: `PrincipalProvider`/`PrincipalGroupRef` in `$lib/sdk/types/sharing.ts` ist die
  einzige Quelle; `members/contract.ts` `MembersService extends PrincipalProvider`.

## KI und externe Dienste (#69)
- `core.ai.use` schickt den Prompt an einen externen Anbieter: keine Art.-9-Daten (Gesundheit), keine Kinder-/Kontaktdaten/IBAN, Namen durch
  Platzhalter ersetzen (Pseudonymisierung), Hinweis in der Oberfläche. Jeder neue externe Empfänger kommt in `docs/security.md` → „Externe Empfänger“.

## Zähler in der Seitenleiste
- `defineModule({ navBadge: { path?, count(ctx) } })` → runde Zahl am Navigationseintrag (z. B. ungelesene Mails, `messages`), ab 10 „9+“.
  Core `core/navigation/badges.ts` `navBadgeCounts(ctx)`: nur aktive Module, nur wenn die Person den Eintrag sieht, Zeitbudget 1,5 s, Fehler
  geloggt und übersprungen. Ausgabe im Root-Layout (`navBadges`) und `GET /api/v1/nav/badges` (nur Anmeldung, 120/min); Client-Store
  `$lib/sdk/client/nav-badges.svelte` (`refreshNavBadges()` nach Aktionen, die den Zähler ändern; das `(internal)`-Layout aktualisiert nach jeder
  Navigation und jede Minute). `count` schnell halten, Core-Dienste nicht in einer offenen Modul-Transaktion.

## Globale Suche
- `defineModule({ search: { permission?, anyPermission?, run(ctx, query, limit) } })` (`ModuleSearchProvider`, Datei `search.ts`): Treffer
  `SearchHit { id, title, subtitle?, href, icon?, type }` für die Befehlspalette. `run` filtert **objektbezogen** wie die Listen-Endpunkte,
  Core-Services außerhalb der Transaktion, LIKE escapen, keine sensiblen Felder (Geburtsdatum, Kontakte, IBAN, Gesundheit). `href` relativ;
  braucht die Seite einen Deep-Link, `?open=<id>` o. Ä. ergänzen und nach dem Öffnen per `replaceState` entfernen.

## Dashboard-Kacheln
- `ui.ts` `dashboardWidgets: [{ id, title, description?, order?, size?: 'sm'|'md'|'lg', permission?, anyPermission?, defaultHidden?, component }]`
  → Kachel auf `/dashboard` (nur aktive Module, nur mit Recht; Typen in `$lib/sdk/types/module-ui`). Komponente in `pages/widgets/`, nutzt
  `DashboardCard`, lädt per `apiFetch`, meldet `onstatus('ready'|'empty'|'error')` – `empty` klappt die Kachel ein („nur Wichtiges“).
- Persönliche Daten über eigene „meine“-Endpunkte (`/my/...`) mit eigenem Recht (`<id>.own.view`, `defaultRoleGrants` Mitglied); nie fremde Daten.

## Profil-Abschnitte und Standard-Rollenrechte
- `ui.ts` `userAdminSections: [{ id, title, order?, permission?, component }]` → Abschnitt im Dialog „Benutzer bearbeiten“
  (`/admin/users`, Props `{ userId, userName }`, lädt und speichert selbst; Auswahl `selectUserAdminSections`). Muster: `files/pages/UserQuotaSection.svelte`.
- `ui.ts` `profileSections: [{ id, title, order?, permission?, component: () => import(…) }]` → Karte auf `/profile`
  (Komponente bekommt `{ userId }`, lädt Daten per `apiFetch`; Auswahl/Sortierung: `selectProfileSections` in
  `$lib/sdk/client/profile-sections`). Typ `ProfileSection` in `$lib/sdk/types/module-ui`.
- `defaultRoleGrants: { Rollenname: [Rechte] }` (Manifest oder `defineModule`): Rolle über Kennung `role.system_key = default:<Name>` suchen/anlegen
  (Core-Migration 0008, #67; gleichnamige Rolle ohne Kennung bekommt **nichts**, Name ist reserviert; im Modul `core.roles.defaultRoleId(name)`
  statt Namenssuche), Rechte
  **einmalig** je (Modul, Rolle, Recht) vergeben (Marker `role_grant_applied`, Core-Migration 0004) – entzogene Rechte
  kommen nicht zurück. Rechte müssen im Manifest stehen.

## Benachrichtigungen an Konten (`core.notifications`, 2026-10-25)
- Mails an **Benutzerkonten** (Hinweise, Ereignisse) nie direkt per `core.mail.send`, sondern `core.notifications.send(ctx, MODULE_ID, [{ type, scope?,
  userIds, title ≤ 150, body ≤ 4000, pushBody?, link?, group?, tag? }])` **nach** der Transaktion (wirft nie). Kanal (Aus · E-Mail · Beides · Push,
  ggf. Sofort/Täglich) wählt jede Person im Profil-Reiter „Benachrichtigungen“; Push ohne Gerät → E-Mail.
- Typen in `defineModule({ notifications: { types: [{ key, label, description?, defaultChannel?, mandatory?, digest?, pushOnly?, scoped?, permission?,
  anyPermission? }], forUser? } })`; `scoped` = je Bereich (Postfach, Amt), Einträge über `forUser(ctx)`. Rechte in `permission` müssen im Manifest stehen.
- Mails an freie Adressen (Anmeldebestätigung, Kontaktadressen der Mitglieder, Massenversand) bleiben `core.mail`; zusätzlicher Push an verknüpfte
  Konten über einen `pushOnly`-Typ (Muster `treasury/push-notify.ts`). Alte eigene Einstellungen per `core.notifications.migratePreferences` übernehmen.
- Keine eigenen Profilkarten für Benachrichtigungs-Einstellungen mehr. Details: `docs/core-services.md` → „core.notifications“.

## Ämter als Vorlage mitbringen (Modul `offices`, optional)
- Manifest: `offices: [{ key, name, description?, notifications: [{ key, label, description? }] }]` (`ModuleOfficeTemplate`, Schlüssel
  `[a-z][a-z0-9-]*`) + `optionalDependencies: ['offices']`. `offices` legt das Amt **einmal** an (nur Vorlage, Marker); danach ist es ein normales,
  löschbares Amt – gelöscht wird es **nicht** neu angelegt.
- Auslösen **nach** der Transaktion: `(await core.modules.useOptional<OfficesService>('offices', MODULE_ID))?.notify(ctx, [{ module, office, event,
  subject, text, link? }])` (Typen aus `$lib/modules/offices/contract`, `import type`). Ereignisse eines Vorgangs in **einem** Aufruf (eine Mail je
  Person), keine IBAN o. Ä. im Text, Aufruf in `try/catch`. Kanal (Aus · E-Mail · Beides · Push, Sofort/Täglich) wählen die Inhaber*innen im Profil-Reiter „Benachrichtigungen“ (Versand über `core.notifications`). Muster:
  `treasury/office-notify.ts`; Details `module-offices.md`.

## Migrationen
- Nummeriert (`0001_init.sql`, `0002_…`), in `module.ts` per `import m from './migrations/…sql?raw'` und `{ name, sql }` registrieren.
- Änderungen an bestehenden Tabellen: `ALTER TABLE … ADD COLUMN IF NOT EXISTS`; CHECK-Constraints ersetzen mit
  `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` (Namen: `<tabelle>_<spalte>_check`).
- Der Runner führt pro Modul beim Aktivieren **und** beim Start (für aktive Module) ausstehende Migrationen aus.
- `search_path` ist dabei **nur** `mod_<id>` (kein `public`): Core-Tabellen sind auch in Migrationen nicht erreichbar.
- Neue Geldspalten `bigint`, FK-Spalten mit Index, Formate als `CHECK` (nachträglich `NOT VALID` → bereinigen → `VALIDATE`, Muster `events/migrations/0003_checks.sql`).
- `MAX(position)+1` nur unter `pg_advisory_xact_lock(hashtext('<modul>:<container>'))` (Muster `orders/articles.endpoints.ts`).

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
