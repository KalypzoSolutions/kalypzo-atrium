# Modulentwicklung

Module liegen unter `src/lib/modules/<id>/` und greifen **ausschließlich** über `$lib/sdk/*` auf den Core zu. Eine ESLint-Regel (`eslint.config.js`) verbietet Importe aus `$lib/server/*`, `$lib/core/*` und `$lib/components/*` in Modulen.

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
- Zugriff im Code: `core.database.forModule('<id>').transaction(async (tx) => …)`. Tabellen anderer Module sind nicht erreichbar; modulübergreifende Zugriffe laufen über definierte Service-Schnittstellen des anderen Moduls.
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

Modulseiten dürfen die gemeinsamen Komponenten aus `$lib/components/ui` und `$lib/components/layout` importieren (ESLint erlaubt dies zusätzlich zu `$lib/sdk/*`). Core-interne Server-Module bleiben tabu.

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
| `ShareDialog` | `$lib/components/layout` | Freigabe an Benutzer: suchen, Stufe wählen, ändern, entfernen (Persistenz über Callbacks) |
| `ShareMenu` | `$lib/components/layout` | Freigabe-Menü für Seitenköpfe: Button mit Avatar-Stapel, öffnet ein Popover mit `SharePanel` |
| `SharePanel` | `$lib/components/layout` | Inhalt der Freigabe (Suche, Zugriffsliste, Stufe ändern, entfernen); von `ShareDialog` und `ShareMenu` genutzt |
| `Slider` | `$lib/components/ui/slider` | Schieberegler (einzelner Wert) mit Tastatur und Pflicht-`label` |
| `NumberStepper` | `$lib/components/layout` | Ganzzahl-Feld mit −/+, Grenzen und optionaler Einheit (`unit`) |
| `MoneyInput` | `$lib/components/layout` | Euro-Eingabe in Cent (deutsch tolerant); Helfer in `money.ts` (`parseEuroToCents`, `formatEuro`) |
| `SummaryList` | `$lib/components/layout` | Ausgerichtete Betragsliste mit Hinweisen, Abzügen und einklappbaren Details |
| `CostBar` | `$lib/components/layout` | Gestapelter Kostenbalken mit Legende (Betrag und Prozent) |
| `FormField`, `PageHeader`, `ConfirmDialog`, `EmptyState` | `$lib/components/layout` | Formular- und Seitenbausteine |
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

### Hintergrundjobs und optionale Abhängigkeiten

- Regelmäßige Aufgaben (Abgleich, Erinnerungs-Mails) als `jobs` im `defineModule` deklarieren (`schedule: 'hourly' | 'daily'`,
  Systemkontext, Rückgabe = kurze Statusmeldung). Details: `docs/core-services.md` → „Hintergrundjobs“. Beispiel: `treasury/module.ts`.
- Rückkanäle zwischen Modulen ohne Zyklus: `manifest.optionalDependencies` + `core.modules.useOptional` (liefert `null`, wenn der
  Anbieter aus ist). Beispiel: `actions` → `treasury` (Ist-Beiträge in der Abrechnung).

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

**`defaultRoleGrants`** (im Manifest oder auf `defineModule`): `{ 'Mitglied': ['members.own.view'] }`. Beim Start (`syncModules`)
wird die Rolle per Name gesucht bzw. angelegt (kein System) und jedes Recht **einmalig je (Modul, Rolle, Recht)** vergeben
(Tabelle `role_grant_applied`). Ein bewusst entzogenes Recht kommt daher nicht zurück; neue Rechte in einer späteren Version
werden dagegen nachgezogen. Rechte müssen im Manifest stehen, sonst werden sie übersprungen.

**Benutzer-Einstellungen** (Katalog `core/settings/catalog.ts`, Gruppe `user`): `core.user.theme`, `core.user.accentColor`
(`''` oder `#rrggbb`), `core.user.density` (`comfortable|compact`), `core.user.startPage` (nur erlaubte Seiten, sonst
`/dashboard`), `core.user.pageSize` (10–200). Listen-Loads nutzen `resolvePageSize(locals, fallback)`
(`core/settings/user-prefs`): ausdrücklich gespeicherter Wert, sonst die Standardgröße der Seite.

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
