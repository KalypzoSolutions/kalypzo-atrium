---
paths:
  - "src/**/*.svelte"
  - "src/lib/components/**"
  - "src/app.css"
---

# UI-Design und UX-Regeln

## Look & Feel
- **Ruhig, hell, sachlich**: weißer Hintergrund (`bg-background`), Karten (`Card`) mit feiner Kontur, viel Weißraum,
  Radius `0.5rem` (`rounded-lg`/`rounded-md`). Dunkelmodus über die Tokens in `src/app.css` (nie feste Farben).
- Primärfarbe = Akzentfarbe aus den Einstellungen (`--accent-color`, Standard `#2563eb`) → `bg-primary`, `ring-ring`.
  Destruktives rot (`destructive`), Hinweise gedämpft (`text-muted-foreground`). Statusfarben sparsam
  (grün = übernommen/gespeichert, amber = Warnung/Abzug).
- Typografie: Standard `text-sm`; Seitentitel `text-2xl font-semibold tracking-tight`; Kartentitel `font-semibold`;
  Hinweise `text-xs text-muted-foreground`; Zahlen/Beträge `tabular-nums`, rechtsbündig.
- Layout: Sidebar links (`w-56`, Einträge `py-1.5`, Gruppen aufklappbar), Kopfzeile `h-14`, Inhalt in `max-w`-freier
  Spalte mit `p-4…8`. Abstände `space-y-4` (innerhalb) / `space-y-6` (Abschnitte). Raster: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`.
- Texte deutsch, du-Ansprache, kurze Sätze. Gendern mit `*` (Teilnehmende*r, Besitzer*in). UI mit echten Umlauten.
- Formate: `de-DE`, Datum `TT.MM.JJJJ`, Beträge `1.234,50 €` (`formatEuro`), Zeiten `HH:MM`.

## Seitenaufbau (Muster)
1. Rücklink (`← Alle Aktionen`), 2. `PageHeader` (Titel, Beschreibung, Aktionen rechts: primär → sekundär → destruktiv),
3. optional `Tabs` mit `variant="line"`, 4. Inhalt in `Card`/`DataTable`. Details im Popover/Dialog, nicht auf neuer Seite,
wenn es nur ein Formular ist. Listen: Suche + Filter in der Toolbar der `DataTable`, Pagination im Footer.
`Tabs variant="line"` bricht um (`flex-wrap` in `tabs-list.svelte`), keine eigenen Scroll-/Wrap-Hacks. Klickbare Tabellenzeilen
öffnen eine schreibgeschützte Ansicht im `ui/sheet` (Bearbeiten erst per Button → Dialog), Zeilen-Aktionen stoppen den Klick.

## Komponenten-Inventar (immer zuerst wiederverwenden)
| Zweck | Import |
|---|---|
| Tabellen-Karte (Toolbar, Laden/Fehler/Leer, Footer; `mobile="cards"`) | `DataTable` aus `$lib/components/layout` |
| Fixierte Aktionsleiste mobil (Bulk) | `MobileActionBar` (`show`, `label`) |
| PDF-Listen mit wählbaren Spalten | `PdfExportDialog` (`catalog`, `count`, `storageKey`, `onexport`) + `$lib/pdf-lists` |
| Seitenkopf, Formularfeld, Leerzustand, Bestätigung | `PageHeader`, `FormField`, `EmptyState`, `ConfirmDialog` |
| Suche / Seitenwechsel (URL-basiert) | `SearchInput` (`param`, `resetParams`), `Pagination` (`pageParam`) |
| Einfachauswahl / Mehrfachauswahl mit Suche | `SelectField` (`ui/select-field`, `emptyLabel`, `name`) / `MultiSelect` (`ui/multi-select`) |
| Freie Tags/Schlagwörter (Chips, Vorschläge, „„x“ anlegen“) | `TagInput` (`ui/tag-input`; `bind:value: string[]`, `suggestions` oder `loadSuggestions(q)` (200 ms Debounce), `max` 20, `maxLength` 40, `label`, `invalid`, `describedby`, `onchange`; Enter/Komma legt an, Blur übernimmt, Backspace entfernt letzten; Logik `addTag()` in `tags.ts`) |
| Farbe | `ColorPicker` (`ui/color-picker`), `ColorBadge`, `EntityAvatar` |
| Zahl mit −/+ , Regler, Geld | `NumberStepper`, `Slider` (`ui/slider`), `MoneyInput` (`money.ts`: `formatEuro`, `parseEuroToCents`) |
| Datei-Upload, Kontaktliste (stapelt unter 640 px) | `FileField`, `ContactListField` |
| Zusammenfassung, Kostenbalken | `SummaryList`, `CostBar` |
| Freigabe | `ShareMenu` (Popover im Seitenkopf), `ShareDialog`, `SharePanel`; Einträge/Kandidaten optional mit `type` (`everyone`/`group`/`role`/`user`/`member` → Icon + Badge), `detail` (Unterzeile statt E-Mail), `color` (Gruppenpunkt); Schlüssel `shareKey` (ohne `type` = Benutzer-ID, sonst `typ:id`, auch für `onchange`/`onremove`). Props `everyoneLabel` (Schnellknopf „… (alle)“ → `onadd({ id: '*', type: 'everyone' })`), `placeholder`, `searchLabel`, `emptyResultText` |
| Erfolgs-Toast mit „Rückgängig“ (Rückweg = vorhandener API-Aufruf) | `toastWithUndo({ message, undo, undone?, onundone? })` aus `$lib/components/layout` (früher `treasury/pages/undo.ts`) |
| Profil-Abschnitt eines Moduls | `ui.ts` `profileSections` (Props `{ userId }`, Daten per `apiFetch`); Muster: `members/pages/ProfileMemberCard.svelte` (Entwurf + Speichern je Tab, kein Autosave, `beforeNavigate`-Warnung) |
| Overlay | `ui/dialog`, `ui/popover`, `ui/sheet`, `ui/dropdown-menu`, `ui/tooltip` |
| Monatskalender (Raster Mo–So, 6 Wochen; mobil Agenda-Liste) | `MonthCalendar` (`items: CalendarItem[]` mit `startsOn`/`endsOn`/`startsTime`/`endsTime`/`color`, optional `recurring` (Wiederhol-Symbol, Titel „(Serie)“ im Label) und `key` (eindeutiger Schlüssel je Vorkommen, sonst `id`), `bind:month` `YYYY-MM`, `today?`, `onselect(item)`, `onday?(date)` → „+“-Knopf je Tag, `loading`); mehrtägige Termine als durchgehende Balken (Spuren je Woche, max. 3, sonst „+n weitere“-Popover), Schriftfarbe per `contrastTextColor`; Logik in `layout/month-calendar.ts` |
| Bestätigung per Eingabe eines Wortes (unumkehrbare Aktionen, z. B. `ZURÜCKSETZEN`) | `TypedConfirmField` (`$lib/components/layout/TypedConfirmField.svelte`; `word`, `bind:value`, `bind:confirmed` – true nur bei exakter, NFC-normalisierter Eingabe; `label?`, `hint?`, `id?`, `disabled?`). Danach destruktiver Button → `ConfirmDialog`; Muster: `/system/reset` |
Neue wiederverwendbare Bausteine kommen nach `components/layout` (fachlich) bzw. `components/ui` (generisch) und
werden in `docs/module-development.md` (Tabelle) und hier ergänzt.

## UX-Regeln
- Formulare: Label über dem Feld, Pflicht mit `*`, Fehler direkt darunter (`text-xs text-destructive`, `role="alert"`,
  `aria-invalid`, `aria-describedby`). Client-Validierung mit denselben Zod-Schemas wie der Server, erstes fehlerhaftes
  Feld fokussieren. Server-Fehler (`ApiClientError.details`) auf Felder abbilden, sonst im Dialog/Toast zeigen.
- Mutationen: Button `disabled` + Text „Speichert …“ während `busy`; Erfolg als `toast.success`, Fehler `toast.error`.
  Löschen immer mit `ConfirmDialog` (destruktiv); wo sinnvoll Rückgängig-Toast.
- Laden: `Skeleton`, Fehlerzustand mit „Erneut versuchen“, Leerzustand mit erklärendem Text und Aktion.
- Autosave (Kalkulation): Debounce ~800 ms, Statuszeile mit `aria-live` („Gespeichert“, „Speichert …“, Fehler + Retry),
  ausstehende Änderungen beim Verlassen flushen, Server-Antworten überschreiben keine laufende Eingabe.
- Berechnungen live und lokal (gleiche reinen Funktionen wie der Server), nie `NaN`, Eingaben klemmen statt abweisen.
- Rechte: Aktionen ohne Berechtigung **ausblenden** bzw. Felder `disabled` mit Hinweis „Nur Ansicht“.
- Mobil (≥ 360 px): einspaltig, Raster `grid-cols-1 sm:grid-cols-N` (nie festes `grid-cols-2/3` in Dialogen ohne `sm:`).
  **Tabellen**: `DataTable mobile="cards"` macht unter 640 px jede Zeile zur Karte (Beschriftung automatisch aus den `<th>`,
  Zellen ohne Kopftext = Checkbox/Aktionen). Für Listen mit vielen Spalten Standard; breite Summen-/Vergleichstabellen bleiben
  `mobile="scroll"` (Default, horizontales Scrollen). `max-w-*`/`truncate` in Zellen wird in Karten umgebrochen.
  **Bulk-Leisten** mit `MobileActionBar` (unten fixiert, Inhalt braucht `pb-20`). **Dialoge** haben Standard-`max-h-[calc(100dvh-2rem)]`
  mit Scroll; kein eigenes `vh` setzen. **Touch-Ziele** ≥ 36 px werden auf Touch-Geräten (`pointer: coarse`) in `app.css`
  erzwungen (Button, Input, Select, Tabs-Trigger, Checkbox) – Desktop bleibt kompakt. Wichtige Summen als fixierte Leiste unten.
- Barrierefreiheit: Icon-Buttons mit `aria-label`, Gruppen mit `fieldset/legend`, Fokus sichtbar, Farbe nie alleiniger Träger.

## Fallen
- **bits-ui setzt `data-state="open|closed|checked|unchecked|active"` und `data-orientation`.** shadcn-Vorlagen anderer
  Versionen nutzen `data-open:`/`data-checked:`/`data-horizontal:` → wirkungslos (unsichtbare Schalter, Tabs als Spalte).
  Immer `data-[state=open]:` / `data-[orientation=horizontal]:` verwenden; Vorlagen beim Einfügen anpassen.
- Kein natives `<select>`, `<input type="color">`, `<input type="date">` nur dort, wo es bereits so gelöst ist (Datumsfelder).
- Svelte 5: `$props`, `$state`, `$derived`, `$bindable`; keine `$effect`-Ketten für abgeleitete Werte; Snippets statt Slots;
  Event-Attribute `onclick={…}`; `{#each … (key)}` immer mit Schlüssel.
- Popover/Dialog-Kombination: Inhalte werden portaliert; Select in Dialog funktioniert über die bits-ui-Layer.
- Tailwind v4: keine `tailwind.config.js`; Tokens in `app.css` (`@theme inline`).
