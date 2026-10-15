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

## Komponenten-Inventar (immer zuerst wiederverwenden)
| Zweck | Import |
|---|---|
| Tabellen-Karte (Toolbar, Laden/Fehler/Leer, Footer) | `DataTable` aus `$lib/components/layout` |
| Seitenkopf, Formularfeld, Leerzustand, Bestätigung | `PageHeader`, `FormField`, `EmptyState`, `ConfirmDialog` |
| Suche / Seitenwechsel (URL-basiert) | `SearchInput` (`param`, `resetParams`), `Pagination` (`pageParam`) |
| Einfachauswahl / Mehrfachauswahl mit Suche | `SelectField` (`ui/select-field`, `emptyLabel`, `name`) / `MultiSelect` (`ui/multi-select`) |
| Farbe | `ColorPicker` (`ui/color-picker`), `ColorBadge`, `EntityAvatar` |
| Zahl mit −/+ , Regler, Geld | `NumberStepper`, `Slider` (`ui/slider`), `MoneyInput` (`money.ts`: `formatEuro`, `parseEuroToCents`) |
| Datei-Upload, Kontaktliste | `FileField`, `ContactListField` |
| Zusammenfassung, Kostenbalken | `SummaryList`, `CostBar` |
| Freigabe | `ShareMenu` (Popover im Seitenkopf), `ShareDialog`, `SharePanel` |
| Overlay | `ui/dialog`, `ui/popover`, `ui/sheet`, `ui/dropdown-menu`, `ui/tooltip` |
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
- Mobil (≥ 360 px): einspaltig, keine horizontale Seitenleiste-Scrolls außer Tabellen (`overflow-x-auto`); wichtige
  Summen als fixierte Leiste unten; Touch-Ziele ≥ 36 px.
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
