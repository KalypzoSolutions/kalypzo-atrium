# Modulentwicklung

Module liegen unter `src/lib/modules/<id>/` und greifen **ausschließlich** über `$lib/sdk/*` auf den Core zu. ESLint (`eslint.config.js`, je Modul ein Block) erzwingt die erlaubte Oberfläche – siehe „Erlaubte Importe“.

## Erlaubte Importe

In `src/lib/modules/<id>/**` sind nur diese Importe erlaubt (Regel `@typescript-eslint/no-restricted-imports`, Test `tests/unit/module-boundaries.test.ts`):

| Ziel | Erlaubt | Zweck |
|---|---|---|
| eigene Moduldateien (`./…`, `$lib/modules/<id>/…`) | ja | |
| `$lib/sdk/*` | ja | Core-Schnittstelle (`server`, `client`, `types`) |
| `$lib/components/ui`, `$lib/components/layout`, `$lib/components/forms` | ja | UI-Bausteine, Formular-Builder |
| `$lib/forms` | ja | Formular-Typen, Feldtypen, Validierung |
| `$lib/pdf-lists` | ja | PDF-Listen: Spaltenauswahl, Layout, `composeListBlocks`, Formatierer, `listSelectionInput`; `$lib/pdf-lists/member-columns` = Mitglieder-Spaltenkatalog (`members` + `actions`) |
| `$lib/utils` | ja | `cn` & Co. |
| `$lib/modules/<anderes>/contract` | **nur** `import type` | Vertrag; Laufzeit über `core.modules.use`/`useOptional` |
| andere Dateien fremder Module (`$lib/modules/<anderes>/…`, `../<anderes>/…`) | nein | |
| `$lib/server/*`, `$lib/core/*`, alle übrigen `$lib/*` | nein | |

Gemeinsam gebrauchte, reine Hilfen gehören in eine dieser neutralen Bibliotheken (oder in den Vertrag als Dienst), nicht in ein Modul, das ein anderes dann importiert.
Zusätzlich meldet `no-restricted-syntax` in `src/lib/modules/**` direkte Zugriffe auf Core-Interna: `core.database.db`, `core.database.transaction`,
`core.system.*`, `core.modules.enable|disable`, `core.auth.instance` und `forModule('<andere-id>')` mit einem String-Literal ungleich der eigenen
Modul-ID (nur statisch erkennbare Zugriffe; Destrukturieren/Aliasse erkennt die Regel nicht – Code-Review bleibt nötig). Das ist eine Leitplanke,
keine Sandbox: Module sind **vertrauenswürdiger Code** im selben Prozess.
Offene Ausnahmen stehen mit Begründung in `OPEN_BOUNDARY_EXCEPTIONS` (`eslint.config.js`) und sind dort zu löschen, sobald sie behoben sind.

## Verzeichnislayout

```text
src/lib/modules/members/
├── module.ts          # Pflicht: Default-Export defineModule({...})
├── ui.ts              # optional: Seiten (Default-Export ModuleUi)
├── migrations/        # SQL (im Schema mod_members)
└── pages/             # Svelte-Komponenten
```

`module.ts` wird zur Build-Zeit per `import.meta.glob('/src/lib/modules/*/module.ts')` entdeckt. Ein neues Modul erscheint danach unter **Module** und ist zunächst **deaktiviert**.

## 1. Manifest und Definition

```ts
// src/lib/modules/members/module.ts
import { defineModule, defineEndpoint, core } from '$lib/sdk/server';
import { z } from 'zod';
import m0001 from './migrations/0001_init.sql?raw';

export default defineModule({
  manifest: {
    id: 'members',                 // [a-z][a-z0-9-]{1,30}, nicht: core, api, auth, admin, system
    name: 'Mitgliederverwaltung',
    version: '1.0.0',              // SemVer
    dependencies: [],              // IDs anderer Module
    permissions: ['members.users.view', 'members.users.edit', 'members.storage.write'],
    navigation: [
      { label: 'Mitglieder', icon: 'users', path: '/modules/members', permission: 'members.users.view' }
    ]
  },
  settings: [
    { key: 'members.welcomeText', label: 'Begrüßung', schema: z.string().max(500), default: '' }
  ],
  migrations: [{ name: '0001_init', sql: m0001 }],
  endpoints: [
    defineEndpoint({
      method: 'GET',
      path: '/users',                       // erreichbar unter /api/v1/modules/members/users
      summary: 'Mitglieder auflisten',
      permission: 'members.users.view',     // Pflicht, nie null
      handler: async ({ ctx }) => {
        return core.database.forModule('members').transaction(async (tx) => {
          // … Drizzle-Abfragen auf Tabellen des Moduls
          return [];
        });
      }
    })
  ]
});
```

Navigationseinträge mit gleichem `group` (optional `groupIcon`) erscheinen in der Seitenleiste als aufklappbare Gruppe mit Icon, z. B. `{ label: 'Mitglieder', icon: 'users', path: '/modules/members', group: 'Verwaltung', groupIcon: 'folder' }`. Die Gruppe ist automatisch offen, wenn eine ihrer Seiten aktiv ist.

Validierungen (beim Registrieren, Fehler beenden den Start): ID-Format, SemVer, Berechtigungen im Schema `members.ressource.aktion` mit Präfix der eigenen ID, Einstellungsschlüssel mit Präfix `members.`, Navigationspfade unter `/modules/members`, keine öffentlichen Endpunkte, keine Abhängigkeitszyklen/unbekannten Abhängigkeiten.

## 2. Berechtigungen

- Schema `<modul>.<ressource>.<aktion>`; Sie werden beim Start in die Tabelle `permission` übernommen und der Systemrolle *Administrator* automatisch zugewiesen.
- Berechtigungen deaktivierter Module sind nicht wirksam.
- **Capability-Berechtigungen** für Core-Services, die im Namen des Moduls laufen:
  - `<modul>.storage.read|write|delete` – Zugriff auf den Speicherbereich des Moduls
  - `<modul>.ai.use` – Nutzung von `core.ai` mit `module: '<modul>'`

  Sie müssen im Manifest deklariert werden, sonst können Rollen sie nicht erhalten.
- Prüfung: `await core.permissions.require(ctx, 'members.users.edit')`.

## 3. Einstellungen

Registrierte Einstellungen sind typisiert (Zod) und mit `core.settings.get/set` nutzbar; `secret: true` speichert verschlüsselt und blendet den Wert in Oberfläche und API aus.

## 4. Datenbank und Migrationen

- Jedes Modul besitzt das Schema `mod_<id>` (Bindestriche → Unterstriche). Es wird beim Aktivieren automatisch angelegt.
- Migrationen: Liste `{ name, sql }`, in Reihenfolge, einmalig, in einer Transaktion mit `search_path = mod_<id>`. Tabellen daher **unqualifiziert** anlegen. Prüfsummen in `module_migration`; nachträgliche Änderung angewendeter Migrationen wird abgelehnt – neue Datei anlegen.
- Zugriff im Code: `core.database.forModule('<id>').transaction(async (tx) => …)`. Tabellen anderer Module und des Core sind nur **unqualifiziert** nicht erreichbar: `search_path` ist eine Konvention, kein Sicherheitsmechanismus – schemaqualifizierte Zugriffe (`mod_x.tabelle`, `public.user`) wären technisch möglich und sind verboten. `forModule` nur mit der eigenen `MODULE_ID` (ESLint, siehe „Erlaubte Importe“). Modulübergreifende Zugriffe laufen über definierte Service-Schnittstellen des anderen Moduls (`provides` + `contract.ts`).
- Drizzle-Tabellen können mit `pgSchema('mod_members')` definiert werden.

## 5. API-Endpunkte

Registrierung über `endpoints` (siehe oben). Der Router prüft automatisch Modulstatus, Authentifizierung, Berechtigung, Rate Limit und Validierung (`params`, `query`, `body` als Zod-Schemas). Sie erscheinen in der OpenAPI-Spezifikation unter dem Tag `Modul: <id>`.

## 6. Benutzeroberfläche

```ts
// src/lib/modules/members/ui.ts
import type { ModuleUi } from '$lib/sdk/types/module-ui';
export default {
  routes: {
    '': () => import('./pages/Index.svelte'),        // /modules/members
    'list': () => import('./pages/List.svelte')       // /modules/members/list
  }
} satisfies ModuleUi;
```

Die Seiten werden über den Catch-all `/modules/[moduleId]/[...path]` ausgeliefert. Der Core prüft vorher Modulstatus und Berechtigungen. Clientseitige Aufrufe laufen über `apiFetch` aus `$lib/sdk/client`.

### Öffentliche Endpoints und Seiten

Standardmäßig ist jede Modul-Route geschützt. Für z. B. ein öffentliches Anmeldeformular gibt es ein kontrolliertes Opt-in:

```ts
defineEndpoint({
  method: 'POST', path: '/public/register', summary: '…',
  permission: null, public: true,                      // beides zwingend
  rateLimit: { limit: 5, windowSec: 60 },              // Pflicht (je IP; zusätzlich Gesamt-Bucket)
  body: registerSchema,                                // bei POST Pflicht; nur GET/POST erlaubt
  handler: async ({ body }) => { … }
});
```

Mutierende öffentliche Aufrufe brauchen `Content-Type: application/json`. Details: [Security](security.md).

Öffentliche Seiten werden in `ui.ts` unter `publicRoutes` deklariert und sind unter `/p/<moduleId>/<pfad>` ohne Login erreichbar (nur wenn das Modul aktiv ist; schlichtes Layout ohne Sidebar, `noindex`):

```ts
export default {
  routes: { … },
  publicRoutes: { 'anmeldung/:id': () => import('./pages/PublicRegister.svelte') }
} satisfies ModuleUi;
```

Öffentliche Seiten dürfen nur öffentliche Endpoints (`public: true`) verwenden.

### E-Mail-Versand

`core.mail.send({ to, subject, text, html? })` sendet über den konfigurierten SMTP-Server. `to` muss eine einzelne gültige Adresse sein (≤ 254 Zeichen), `subject` ohne Zeilenumbrüche (≤ 200), `text` ≤ 20000 Zeichen; sonst `validation_failed`. Ist SMTP nicht konfiguriert, wirft der Aufruf `unavailable`; SMTP-Fehler werden durchgereicht – der Aufrufer entscheidet, ob die Anfrage trotzdem gelingt.

### Datei-Uploads über Modul-Endpoints

Uploads laufen als `multipart/form-data` über einen normalen Modul-Endpunkt. Der Endpunkt deklariert **kein** `body`-Schema; der Handler liest `await request.formData()` (z. B. Feld `file`), prüft Typ und Größe und legt die Datei mit `core.storage.upload(ctx, { module, path, file, contentType, name })` ab. Die Storage-Rechte (`<modul>.storage.write|read|delete`) prüft `core.storage` selbst. Clientseitig akzeptiert `apiFetch` ein `FormData` als `body` und setzt den multipart-Header samt Boundary selbst. Downloads dürfen eine fertige `Response` (mit `content-type`/`content-disposition`) zurückgeben. Vorlage: `src/lib/modules/members/documents.endpoints.ts`.

### UI-Komponenten in Modulen

Modulseiten dürfen die gemeinsamen Komponenten aus `$lib/components/ui`, `$lib/components/layout` und `$lib/components/forms` importieren (siehe „Erlaubte Importe“). Core-interne Server-Module bleiben tabu.

Damit Core und Module einheitlich aussehen, gibt es fertige Bausteine; neue Seiten verwenden diese statt eigener Varianten (keine nativen `<select>`, keine selbstgebauten Tabellen-Karten):

| Komponente | Import | Zweck |
|---|---|---|
| `DataTable` | `$lib/components/layout` | Karte mit Toolbar (Suche/Filter), Lade-/Fehler-/Leer-Zustand, scrollbarer Tabelle und Fußzeile (Pagination) |
| `PdfExportDialog` | `$lib/components/layout` | Auswahl-Dialog für PDF-Listen: Voreinstellungen, Spalten je Gruppe, „Leere Spalten ausblenden“, Seitenschätzung, merkt die Auswahl je `storageKey`; Bibliothek `$lib/pdf-lists` (`normalizeSelection`, `buildListBlocks`, `estimatePages`) |
| `SelectField` | `$lib/components/ui/select-field` | Einfachauswahl mit optionalem „Alle“-Eintrag (`emptyLabel`) |
| `MultiSelect` | `$lib/components/ui/multi-select` | Mehrfachauswahl mit Suche, Checkboxen und Chips |
| `ColorPicker` | `$lib/components/ui/color-picker` | Eigener Farbwähler (Fläche, Farbton, Hex, Presets); Helfer in `color.ts` |
| `ColorBadge` | `$lib/components/layout` | Badge in frei wählbarer Farbe mit lesbarer Textfarbe |
| `EntityAvatar` | `$lib/components/layout` | Rundes Bild mit Farbrand, Fallback Initialen |
| `FileField` | `$lib/components/layout` | Datei-Feld mit Typ-/Größenprüfung, vorhandener Datei und Entfernen |
| `ContactListField` | `$lib/components/layout` | Dynamische Liste benannter Kontakte (Telefon, E-Mail); `readonly` + `emptyText` für Ansichten |
| `TagInput` | `$lib/components/ui/tag-input` | Freie Tags als Chips (`bind:value`, `suggestions` oder `loadSuggestions(q)`, `max`, `maxLength`); Logik in `tags.ts` (`addTag`, `normalizeTag`) |
| `MonthCalendar` | `$lib/components/layout` | Monatsraster Mo–So mit mehrtägigen Balken, mobil Agenda; `items: CalendarItem[]`, `bind:month`, `onselect`, `onday` |
| `ShareDialog` | `$lib/components/layout` | Freigabe an Benutzer oder – mit `type` – an Principals (Stamm, Gruppe, Rolle, Mitglied): suchen, Stufe wählen, ändern, entfernen (Persistenz über Callbacks); `everyoneLabel` für „alle“ |
| `ShareMenu` | `$lib/components/layout` | Freigabe-Menü für Seitenköpfe: Button mit Avatar-Stapel, öffnet ein Popover mit `SharePanel` |
| `SharePanel` | `$lib/components/layout` | Inhalt der Freigabe (Suche, Zugriffsliste, Stufe ändern, entfernen); von `ShareDialog` und `ShareMenu` genutzt |
| `Slider` | `$lib/components/ui/slider` | Schieberegler (einzelner Wert) mit Tastatur und Pflicht-`label` |
| `NumberStepper` | `$lib/components/layout` | Ganzzahl-Feld mit −/+, Grenzen und optionaler Einheit (`unit`) |
| `MoneyInput` | `$lib/components/layout` | Euro-Eingabe in Cent (deutsch tolerant); Helfer in `money.ts` (`parseEuroToCents`, `formatEuro`) |
| `SummaryList` | `$lib/components/layout` | Ausgerichtete Betragsliste mit Hinweisen, Abzügen und einklappbaren Details |
| `CostBar` | `$lib/components/layout` | Gestapelter Kostenbalken mit Legende (Betrag und Prozent) |
| `FormField`, `PageHeader`, `ConfirmDialog`, `EmptyState` | `$lib/components/layout` | Formular- und Seitenbausteine (`FormField` verknüpft Hinweis/Fehler selbst per `aria-describedby`/`aria-invalid`, `required` → `*`) |
| `LoadingState`, `ErrorState` | `$lib/components/layout` | Einheitlicher Lade-/Fehlerzustand (`role="status"` + „Lädt …“; Fehler mit „Erneut versuchen“ über `onretry`) |
| `SearchInput`, `Pagination` | `$lib/components/layout` | URL-basierte Suche und Seitenwechsel; `param`/`resetParams` bzw. `pageParam` (Seitenzahl statt `offset`) passen sie an die Server-Logik an |

### Routen mit Parametern

`ui.routes` akzeptiert neben exakten Pfaden auch Muster mit `:param`-Segmenten, z. B. `'actions/:id'`. Die Seitenkomponente erhält `params` und `path` als Props (`ModulePageProps` aus `$lib/sdk/types/module-ui`); exakte Treffer haben Vorrang.

```svelte
<script lang="ts">
  import type { ModulePageProps } from '$lib/sdk/types/module-ui';
  let { params }: ModulePageProps = $props();   // params.id
</script>
```

### Benutzerverzeichnis und Verschlüsselung

- `core.users.directory(ctx, { search, ids, limit })`: aktive Benutzer (nur `id`, `name`, `email`), braucht nur Anmeldung, Suche ab 2 Zeichen, maximal 30 Treffer – etwa für Freigaben. Der Modul-Endpoint schützt den Zugriff mit einer eigenen Berechtigung.
- **Wichtig:** Core-Services (`core.users.directory`, `core.storage`, `core.audit` …) nicht innerhalb einer `forModule(...).transaction` aufrufen, sondern davor oder danach. Sie nutzen die Core-Verbindung; auf Einzelverbindungs-Treibern (PGlite in Tests/Demo) blockiert das die offene Transaktion.
- `core.crypto.forModule('<id>')` liefert `encrypt`/`decrypt`/`isEncrypted` (AES-256-GCM, Schlüssel je Modul) für sensible Felder wie IBAN. Klartext nie in API-Antworten oder Audit-Metadaten ausgeben.

### Freigabe an Principals

Objekte (z. B. Termine) können statt nur an Benutzer an **Principals** freigegeben werden: `everyone` (ID `*`, der ganze
Stamm), `group` und `member` (aus dem Modul `members`), `role`, `user`. Typen: `$lib/sdk/types/sharing`, Logik: `$lib/sdk/server`.

- Tabelle im Modulschema: `<obj>_shares(<obj>_id, principal_type, principal_id, level, created_by, created_at)` mit
  Primärschlüssel `(<obj>_id, principal_type, principal_id)`.
- Im Handler die Schlüssel des Aufrufers (`typ:id`) **vor** der Transaktion holen und in SQL vergleichen:

```ts
const keys = await principalKeysFor(ctx, 'events');
await core.database.forModule('events').transaction(async (tx) =>
  tx.execute(sql`SELECT 1 FROM event_shares s WHERE s.event_id = ${id} AND ${principalMatchSql('s', keys)}`)
);
```

- Eingaben mit `validatePrincipals(ctx, modul, shares)` prüfen (422), Anzeige mit `describePrincipals`, Suche mit
  `searchPrincipals(ctx, modul, q, { everyoneLabel })`. Für Rollen nutzt der Core `core.roles.directory`.
- `members` in `optionalDependencies` aufnehmen; ohne aktives `members` entfallen Gruppen und Mitglieder.
- UI: `SharePanel`/`ShareMenu`/`ShareDialog` mit `type` an Einträgen/Kandidaten. Vorlage: Modul `events`.

### Hintergrundjobs und optionale Abhängigkeiten

- Regelmäßige Aufgaben (Abgleich, Erinnerungs-Mails) als `jobs` im `defineModule` deklarieren (`schedule: 'hourly' | 'daily'`,
  Systemkontext, Rückgabe = kurze Statusmeldung). Details: `docs/core-services.md` → „Hintergrundjobs“. Beispiel: `treasury/module.ts`.
- Rückkanäle zwischen Modulen ohne Zyklus: `manifest.optionalDependencies` + `core.modules.useOptional` (liefert `null`, wenn der
  Anbieter aus ist). Beispiel: `actions` → `treasury` (Ist-Beiträge in der Abrechnung).

### Benutzerkonto gelöscht (`onUserDeleted`) – Pflicht für Module mit `user_id`-Spalten

Module speichern Benutzer-IDs ohne Fremdschlüssel (anderes Schema), daher gibt es keine Kaskade. Wer Spalten wie `user_id`,
`owner_id`, `created_by` oder Freigaben an `user:<id>` führt, implementiert den Hook (Datei `user-deleted.ts`):

```ts
export const onUserDeleted: ModuleDefinition['onUserDeleted'] = async (tx, { userId, transferTo }) => {
	await tx.execute(sql`DELETE FROM <obj>_shares WHERE principal_type = 'user' AND principal_id = ${userId}`);
	if (transferTo) await tx.execute(sql`UPDATE <obj> SET owner_id = ${transferTo} WHERE owner_id = ${userId}`);
	await tx.execute(sql`UPDATE <obj> SET created_by = NULL WHERE created_by = ${userId}`);
	return { afterCommit: () => removeObjects(paths) }; // optional: Storage, Core-Services
};
```

- Aufruf: `deleteUser` (Core) **nach** dem Löschen der Core-Zeile, je **aktivem** Modul in einer eigenen Modul-Transaktion
  (`search_path` = Modulschema, keine Core-Services darin). `afterCommit` läuft danach (Storage-Objekte entfernen, Core-Services
  wie `core.roles.replaceModuleGrants`). Fehler eines Moduls werden protokolliert und im Audit `core.user.deleted` als
  `cleanupFailed: [modul]` vermerkt; das Löschen bricht nicht ab.
- Entscheidung je Daten: **persönliche** Daten löschen (Dateien, Bio, Benachrichtigungs-Einstellungen, Konto-Verknüpfungen),
  **Stammesdaten** behalten und Eigentum an `transferTo` (= löschende Person; `null` bei Systemaufrufen) übergeben,
  Zuordnungs-Spalten (`created_by` …) auf `NULL` setzen. Im Kopfkommentar von `user-deleted.ts` dokumentieren.
- Gemeinsame SQL-Logik mit `resetUsers` wiederverwenden (Muster: `offices/reset.ts` `deletePersonRows`, `members/reset.ts` `unlinkUsers`).
- Umgesetzt in `files` (Ablage samt Links/Freigaben und Storage-Objekten löschen), `offices` (Inhaber*innen, Bio, Einstellungen,
  Warteschlange, danach `syncGrants`), `members` (Verknüpfungen lösen), `events`, `galleries`, `actions` (Eigentum übergeben,
  Benutzer-Freigaben weg, Anmeldungen ohne Kontobezug), `orders` (Zuordnungen `NULL`). `treasury` speichert nur Zuordnungs-Spalten
  (`created_by`, `filed_by`) und hat (noch) keinen Hook. Der Core entfernt zusätzlich das Profilbild (`core/avatars/<id>`).
- Test: `tests/integration/user-deletion-cleanup.test.ts`.

### Mitglied gelöscht (`onMemberDeleted`) und Datenauskunft (`subjectExport`)

- `onMemberDeleted(tx, { memberIds, reason: 'deleted' | 'anonymized' })`: Pflicht für Module, die **Kopien** von Mitgliedsdaten
  (`member_id`-Spalten) halten. Ausgelöst nur von `members` (`core.modules.memberDeleted`) nach dem Löschen bzw. Anonymisieren,
  Aufruf wie `onUserDeleted` (eigene Transaktion je aktivem Modul, `afterCommit`, Fehler werden protokolliert). Muster: `actions/privacy.ts`.
- `subjectExport: { findSubjects?, resolve?, run }` (`ModuleSubjectExport`): Beitrag zur Datenauskunft `/admin/privacy`
  (Art. 15/20). `run({ userId, memberIds })` liefert alle Daten der Person im Modul als JSON oder `null` – eigene Transaktion,
  keine Rechteprüfung (Core prüft `core.privacy.export`), keine Dateiinhalte, keine Daten Dritter. `resolve` ergänzt Kennungen
  (members: Konto → verknüpfte Mitglieder), `findSubjects` macht Personen ohne Konto auffindbar. Umgesetzt in allen acht Modulen
  (`members`, `actions`, `treasury`, `events`, `galleries`, `offices`, `orders`, `files`; Dateien `subject-export.ts` bzw. `actions/privacy.ts`).
  Details: `docs/security.md` → „Löschkonzept“.

### Ämter als Vorlage und Benachrichtigungen (Modul `offices`)

Ein Modul kann Ämter mitbringen, deren Inhaber*innen bei Ereignissen eine Mail an ihre Konto-Adresse bekommen
(Beispiel: Kasse → Amt „Kasse“). Das Modul `offices` legt jede Vorlage **einmal** an; danach ist es ein normales Amt
(umbenennen, Personen zuordnen, löschen). Ein gelöschtes Vorlagen-Amt wird nicht neu angelegt.

```ts
// module.ts (Manifest)
optionalDependencies: ['offices'],
offices: [
	{
		key: 'kasse', name: 'Kasse', description: 'Kassenführung des Stamms',
		notifications: [{ key: 'payable-created', label: 'Neue Überweisung steht an' }]
	}
]

// Auslöser, NACH der Transaktion
import type { OfficesService } from '$lib/modules/offices/contract';
try {
	const offices = await core.modules.useOptional<OfficesService>('offices', MODULE_ID); // null, wenn aus
	await offices?.notify(ctx, [
		{ module: MODULE_ID, office: 'kasse', event: 'payable-created',
		  subject: 'Neue Überweisung: 12,00 € an …', text: '…', link: '/modules/treasury?tab=outgoing' }
	]);
} catch (e) { console.error(e); }
```

- Ereignisse eines Vorgangs in **einem** Aufruf übergeben: „Sofort“ verschickt je Person **eine** gebündelte Mail.
- Die Inhaber*innen wählen im Profil je Ereignis **Sofort / Täglich (Zusammenfassung) / Aus** (Standard Sofort); „Täglich“
  sammelt der Job `offices.notify-digest`.
- `subject` ≤ 150 Zeichen, `text` ≤ 4000 Zeichen Klartext, keine sensiblen Daten (IBAN, Gesundheitsdaten); `link` relativ.
- Rückgabe `{ sent, queued, skipped }`; `notify` wirft nie. Vollständige Regeln: `.claude/rules/module-offices.md`.

### Profil-Abschnitte und Standard-Rollenrechte

**`profileSections`** (in `ui.ts`) fügen der Seite `/profile` eigene Karten hinzu (z. B. verknüpfte Mitglieder):

```ts
export default {
	routes: { … },
	profileSections: [
		{
			id: 'children', title: 'Meine Kinder', order: 10,       // order: aufsteigend, Standard 100
			permission: 'members.own.view',                        // optional; ohne = alle Angemeldeten
			component: () => import('./pages/ProfileMembers.svelte') // Props: { userId: string }
		}
	]
} satisfies ModuleUi;
```

`profile/+page.server.ts` liefert `activeModules` und `permissions`; `profile/+page.ts` lädt die `ui.ts` aktiver Module,
filtert und sortiert mit `selectProfileSections` (`$lib/sdk/client/profile-sections`) und gibt `sections`
(`{ key: '<moduleId>:<id>', moduleId, id, title, order, component }`) zurück. Die Komponente lädt ihre Daten selbst per
`apiFetch`; Rechte werden serverseitig an den Endpoints durchgesetzt.

### Dashboard-Kacheln

**`dashboardWidgets`** (in `ui.ts`) fügen dem Dashboard `/dashboard` Kacheln hinzu. Das Dashboard zeigt nur Kacheln **aktiver**
Module mit vorhandenem Recht – so passt es sich automatisch an Module, Rollen und Ämter (Ämter verleihen Rollen) an:

```ts
dashboardWidgets: [
	{
		id: 'upcoming', title: 'Nächste Termine', description: 'Kommende Termine, die du sehen darfst',
		order: 10,                                   // Standard-Reihenfolge, Standard 100
		size: 'sm',                                  // sm = 1 Spalte, md = 2, lg = volle Breite
		permission: 'events.event.view',             // optional
		anyPermission: ['a.b.c', 'a.b.d'],           // optional: mindestens eines
		defaultHidden: false,                        // optional: erst unter „Anpassen“ einschalten
		component: () => import('./pages/widgets/UpcomingWidget.svelte') // Props: DashboardWidgetProps
	}
]
```

Die Komponente (`DashboardWidgetProps { userId, size, onstatus? }`) lädt ihre Daten per `apiFetch`, nutzt `DashboardCard`
(`$lib/components/layout`) und meldet nach dem Laden `onstatus('ready')` bzw. **`onstatus('empty')`**, wenn es nichts Wichtiges
gibt – das Dashboard klappt die Kachel dann zu „Nichts Neues bei …“ ein. Auswahl/Anordnung: `selectDashboardWidgets`,
`applyDashboardLayout` (`$lib/sdk/client/dashboard-widgets`); Core-Kacheln liegen als Pseudo-Modul `core` in
`src/lib/components/dashboard/`. Jede Person kann Kacheln unter „Anpassen“ aus-/einblenden und sortieren
(Einstellung `core.user.dashboard`, `PUT /dashboard/layout`).

**`defaultRoleGrants`** (im Manifest oder auf `defineModule`): `{ 'Mitglied': ['members.own.view'] }`. Beim Start (`syncModules`)
wird die Rolle per Name gesucht bzw. angelegt (kein System) und jedes Recht **einmalig je (Modul, Rolle, Recht)** vergeben
(Tabelle `role_grant_applied`). Ein bewusst entzogenes Recht kommt daher nicht zurück; neue Rechte in einer späteren Version
werden dagegen nachgezogen. Rechte müssen im Manifest stehen, sonst werden sie übersprungen.

**Benutzer-Einstellungen** (Katalog `core/settings/catalog.ts`, Gruppe `user`): `core.user.theme`, `core.user.accentColor`
(`''` oder `#rrggbb`), `core.user.density` (`comfortable|compact`), `core.user.startPage` (nur erlaubte Seiten, sonst
`/dashboard`), `core.user.pageSize` (10–200), `core.user.dashboard` (`{ order, hidden }` mit Kachel-Schlüsseln `<modul>:<id>`, `null` = Standard). Listen-Loads nutzen `resolvePageSize(locals, fallback)`
(`core/settings/user-prefs`): ausdrücklich gespeicherter Wert, sonst die Standardgröße der Seite.

## Weitere Modul-Hooks

Übersicht aller optionalen Felder von `ModuleDefinition` (`src/lib/server/core/modules/types.ts`), der relevanten
`ModuleManifest`-Felder (`$lib/sdk/types`) und der `ModuleUi`-Felder (`$lib/sdk/types/module-ui`). Pflicht sind nur `manifest`
(mit `id`, `name`, `version`, `dependencies`, `permissions`, `navigation`) und in `ui.ts` `routes`.

### `defineModule({ … })` (`module.ts`)

| Feld | Zweck | Vorbild |
|---|---|---|
| `settings` | Typisierte Einstellungen (`ModuleSettingDefinition`: Zod-Schema, `default`, `secret`, `writePermission`), Schlüssel mit Präfix `<id>.`; ohne eigene Seite erscheinen sie unter Einstellungen → Module. | `treasury`, `files` |
| `endpoints` | REST-Endpunkte unter `/api/v1/modules/<id>/…` (`defineEndpoint`); feste Pfade vor `:id`-Mustern deklarieren. | alle |
| `migrations` | `{ name, sql }[]` im Schema `mod_<id>`, additiv und unveränderlich (Prüfsumme). | alle |
| `provides` | Dienste für andere Module (Laufzeit über `core.modules.use`/`useOptional`). **Regel:** Objekt mit `satisfies <Vertrag>` angeben (`provides: officesService satisfies OfficesService`), nie `as unknown as` – sonst fallen Abweichungen zwischen Vertrag (`contract.ts`) und Umsetzung nicht auf. | `offices`, `events`, `treasury` |
| `jobs` | Hintergrundjobs `{ id, summary, schedule: 'hourly' \| 'daily', run(ctx) }`, nur bei aktivem Modul, Systemkontext (siehe [Core-Services](core-services.md#hintergrundjobs-moduledefinitionjobs-corejobs)). | `treasury`, `offices` |
| `defaultRoleGrants` | Rollenname → Rechte, einmalig je (Modul, Rolle, Recht); gleichwertig zu `manifest.defaultRoleGrants` (siehe oben). | `members`, `orders` |
| `resetAreas` | Bereiche für `/admin/reset` (`ResetArea`: `id`, `label`, `description`, `tables` in Löschreihenfolge, `storagePrefixes`, `implies` = zwingend mitgelöschte Bereiche auch fremder Module, `rebuild` = Schema neu aufbauen inkl. Startdaten). In der `description` nennen, welche Verweise anderer Module verwaisen. | `offices/reset.ts`, `actions/reset.ts` |
| `resetUsers(tx, keepUserId)` | Beim Reset der Benutzer*innen Verweise auf gelöschte Konten bereinigen (Modul-Transaktion, keine Core-Services). | `offices/reset.ts`, `members/reset.ts` |
| `onUserDeleted(tx, { userId, transferTo })` | Konto gelöscht: persönliche Daten löschen, Stammesdaten übergeben (siehe oben). Pflicht bei `user_id`-/`created_by`-Spalten. | `files/user-deleted.ts` |
| `onMemberDeleted(tx, { memberIds, reason })` | Mitglied gelöscht/anonymisiert: Kopien der Mitgliedsdaten löschen bzw. anonymisieren (siehe oben). | `actions/privacy.ts` |
| `subjectExport` | Beitrag zur Datenauskunft `/admin/privacy` (`findSubjects?`, `resolve?`, `run`, siehe oben). | `members/subject-export.ts` |
| `backup.rehash(tx, { hash, decrypt })` | Nach Wiederherstellen/Zusammenführen einer Sicherung mit **anderem Schlüssel** (`APP_SECRET`): schlüsselgebundene Hashes mit dem Zielschlüssel neu berechnen; idempotent, Rückgabe `{ updated, unrecoverable }`, keine Core-Services. **Pflicht für jede neue `*_hash`-Spalte mit `core.crypto.forModule(id).hash(…)`.** Ohne Hook passen die Hashes nach dem Umzug auf einen anderen Server zu keiner Eingabe mehr: Lookups über den Hash (Link-Token, Verknüpfungscode, IBAN-Abgleich) finden nichts, Links/Codes sind tot, Zuordnungen fehlen still. Werte ohne entschlüsselbare Quelle als `unrecoverable` auf `NULL` setzen. | `treasury/backup.ts` (IBAN), `files/backup.ts`, `members`/`actions` (`link-tokens.ts`) |
| `search` | Quelle für die globale Suche (Befehlspalette, `ModuleSearchProvider { permission?, anyPermission?, run(ctx, query, limit) }`): `run` filtert selbst objektbezogen (Freigaben, eigene Daten), liefert nur sichtbare Felder und relative Links; Fehler überspringen die Quelle. | `events/search.ts`, `members/search.ts` |
| `onEnable(ctx)` / `onDisable(ctx)` | Laufen **nach** dem Aktivieren (Migrationen + Audit, außerhalb der Transaktion) bzw. Deaktivieren über `core.modules.enable|disable`; nicht beim Start und nicht beim Übernehmen des Modulstatus aus einer Sicherung. Für einmalige Nacharbeiten (z. B. Altbestand verschlüsseln/hashen). | `actions`, `members` (`onEnable`); `onDisable` nutzt derzeit kein Modul |

### Manifest

| Feld | Zweck | Vorbild |
|---|---|---|
| `optionalDependencies` | Module, deren Dienste genutzt werden, **wenn** sie aktiv sind (`core.modules.useOptional` → sonst `null`); keine Aktivierungsreihenfolge. Rückkanäle ohne harte Abhängigkeit. | `actions` → `treasury`, Module → `offices` |
| `permissionDescriptions` | Beschreibung je Recht (Anzeige unter Rollen/Berechtigungen und bei API-Key-Scopes). | `offices`, `files` |
| `offices` | Amt-Vorlagen `{ key, name, description?, notifications[] }` für das Modul `offices` (siehe „Ämter als Vorlage“). | `treasury` (`kasse`), `orders` (`kaemmerer`) |
| `navigation[].admin` | `admin: true` stellt den Eintrag in die Gruppe „Administration“ (Abschnitt „Module“ unter `/admin`, Befehlspalette); Einstellungen des Moduls erscheinen dann unter Einstellungen → Module nur als Link. | `treasury` (Kassen-Einstellungen) |
| `navigation[].group` / `groupIcon` | Aufklappbare Gruppe in der Seitenleiste (siehe oben). | |

### `ui.ts` (`ModuleUi`)

| Feld | Zweck | Vorbild |
|---|---|---|
| `publicRoutes` | Seiten ohne Login unter `/p/<id>/<pfad>`, nur mit öffentlichen Endpunkten (siehe oben). | `actions` (Anmeldung), `files` (Links) |
| `profileSections` | Karten auf `/profile` (siehe oben). | `members`, `offices` |
| `dashboardWidgets` | Kacheln auf `/dashboard` (siehe oben). | `events`, `treasury` |

### Audit-Aktionsnamen

Neue Audit-Aktionen folgen dem Schema der Rechte: `modul.ressource.aktion`, mehrteilige Aktionen mit **Bindestrich**
(`offices.office.holders-changed`, `orders.order.handed-out`). Bestehende Namen mit Unterstrich (z. B. `treasury.invoice.marked_paid`,
`actions.accounting.club_paid`) bleiben wegen der Historie im Audit-Log unverändert – Filter müssen beide Schreibweisen kennen.

## 7. Tests

```ts
import { beforeAll, it, expect } from 'vitest';
import { useTestDatabase } from '../helpers/db';          // PGlite + Core-Migrationen
import { registerModule } from '$lib/server/core/modules/registry';
import { enableModule, syncModules } from '$lib/server/core/modules/service';

beforeAll(async () => {
  await useTestDatabase();
  registerModule(def);       // Definition des Moduls
  await syncModules();
});
```

Vorlage: `tests/integration/core.test.ts` (Modulaktivierung, Abhängigkeiten, API-Zugriff mit API-Keys). `tests/setup.ts` setzt die nötigen Umgebungsvariablen.

## Checkliste

- [ ] Manifest valide, Berechtigungen mit Modulpräfix
- [ ] Nur `$lib/sdk/*`-Importe (`npm run lint`)
- [ ] Migrationen idempotent im Modulschema
- [ ] Jede Operation mit `ctx` und `core.permissions.require`
- [ ] Tests für Rechte und Modulstatus
- [ ] `onUserDeleted`, wenn das Modul Benutzer-IDs speichert
- [ ] `onMemberDeleted` bei Kopien von Mitgliedsdaten, `subjectExport` bei personenbezogenen Daten
- [ ] `backup.rehash` für jede `*_hash`-Spalte mit `core.crypto.forModule(id).hash`
- [ ] `resetAreas`/`resetUsers`, `search` und `provides … satisfies <Vertrag>` (siehe „Weitere Modul-Hooks“)
- [ ] Neue Audit-Aktionen mit Bindestrich (`modul.ressource.aktion-mit-bindestrich`)
