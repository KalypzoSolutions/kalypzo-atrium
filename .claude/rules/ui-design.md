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
  `--primary-foreground` wird im CSS **automatisch** hell/dunkel nach Luminanz gewählt (`color(from var(--primary) srgb …)`,
  Schwelle 0,18; gleiche Regel `primaryForeground()` in `ui/color-picker/contrast.ts`) – auch für die persönliche Farbe und
  lokale Wrapper mit `style="--accent-color:…"`. Textlinks immer `text-link` (dunkel aufgehellt), nie `text-primary`.
  Destruktives rot (`destructive`), Hinweise gedämpft (`text-muted-foreground`). Statusfarben sparsam
  (grün = übernommen/gespeichert, amber = Warnung/Abzug).
- **Status-Tokens** (hell + dunkel in `app.css`; nie Palettenklassen wie `text-amber-700`/`bg-green-600`):

  | Bedeutung | Text/Symbol | Volle Fläche | Getönte Fläche / Rand |
  |---|---|---|---|
  | Erfolg (gespeichert, bezahlt) | `text-success` | `bg-success text-success-foreground` | `bg-success-muted` / `border-success-border` |
  | Warnung (Abzug, Frist, prüfen) | `text-warning` | `bg-warning text-warning-foreground` | `bg-warning-muted` / `border-warning-border` |
  | Info (neutraler Hinweis) | `text-info` | `bg-info text-info-foreground` | `bg-info-muted` / `border-info-border` |
  | Fehler/Löschen | `text-destructive` | `bg-destructive text-destructive-foreground` | `bg-destructive-muted` / `border-destructive-border` |

  Hinweisboxen = `Alert variant="info|success|warning|destructive"` (info/success → `role="status"`, sonst `alert`),
  Status-Chips = `Badge variant="success|warning|info|destructive"`. Bestätigungsknopf in Lösch-/Reset-Dialogen =
  `Button variant="destructive-solid"` (`ConfirmDialog destructive` nutzt ihn selbst). `color-scheme` ist je Modus gesetzt
  (native Datums-/Zeitfelder, Scrollleisten dunkel). Kontraste prüft `tests/unit/design-tokens-contrast.test.ts` (WCAG AA),
  Rückfälle in `components`/`routes` `tests/unit/design-guard.test.ts` (Palettenklassen, `text-white`, `text-primary`,
  native Checkbox/Textarea in `/admin`). Ausnahmen: Datenvisualisierung (`CostBar`), PDF-/Mail-Vorschau und QR-Code (`bg-white`).
  Migriert und vom Guard erfasst: `actions`, `events`, `files`, `galleries`, `members`, `orders`, `offices`, `treasury`
  (`MIGRATED_MODULES`, alle Fachmodule). Ausnahme `text-white`: Bildbetrachter mit immer dunkler Bühne (`files/FilePreview`, `galleries/ImageViewer`).
  **Dateityp-Farben** (2026-10-26): `--file-pdf|word|sheet|slides|image|archive|media|code` → `text-file-<art>`, getönt `bg-file-<art>-muted`
  (nur für Dateisymbole, Zuordnung in `files/pages/file-types.ts`; Kontrast im selben Test).
  Akzentfarbige Symbole/Links = `text-link` (auch `text-link/80`), nie `text-primary`.
- **Persönliche Themes** (2026-10-26): Hintergrund als feste Ebene `body::before` hinter der Seite (`[data-app-theme='on']`,
  Variablen `--app-bg-*`/`--app-veil-*`/`--app-sidebar-*` am `<html>`), Seitenleiste `bg-sidebar-surface`, Kopfzeile `bg-topbar-surface` + `app-glass`
  (Weichzeichner nur mit Theme), mobiles Sheet `app-backdrop`. **`--background` bleibt immer einfarbig** (Fläche für Knöpfe, Tabs, Leisten) –
  nie einen Verlauf hineinlegen; Karten/Dialoge bleiben `--card`/`--popover`. Logik `$lib/appearance` (siehe `architecture.md`).
- Typografie (#71, `@utility` in `app.css`, in `cn()` als Schriftgröße registriert): Seitentitel `text-title` (= 2xl semibold tight,
  `PageHeader`), Abschnittsüberschrift `text-section` (lg semibold), Kleinschrift `text-caption`/`text-xs` – **nie** `text-[10px]/[11px]`.
  `Card.Title` rendert eine Überschrift (`level`, Standard `h2`; Karten unter Abschnitt/in Dialogen `level={3}`; Login/Passwort `level={1}`),
  ohne Größen-Override (`text-section` ist erlaubt); `DataTable titleLevel`. Hinweise `text-xs text-muted-foreground`;
  Zahlen/Beträge `tabular-nums`, rechtsbündig.
- Seitentitel: `PageTitle` (`$lib/components/layout`, `title`) → `<title>` „Seite – Systemname“ (`documentTitle`). Modulseiten bekommen ihn
  zentral aus dem Navigationseintrag (`navLabelFor` in `modules/[moduleId]/[...path]`); eigene `PageTitle` (z. B. Datensatzname) überschreibt.
- Fokus (#71): Token `--focus-ring` (volle Akzentfarbe, dunkel `--link`), globale `:focus-visible`-Outline 2 px + 2 px Abstand für alle
  Elemente ohne eigenen Stil, Utility `focus-ring` für native Elemente; Core-Bausteine `focus-visible:ring-ring` (nie `/50`). Skip-Link
  „Zum Inhalt springen“ (`.skip-link`) als erstes Element im `(internal)`-Layout. `prefers-reduced-motion` global in `app.css`
  (Ladekreisel drehen langsam weiter). Ladetexte als Konstanten `BUSY_SAVE` („Speichert …“) & Co. (`layout/busy.ts`).
- Layout: Sidebar links (`w-56`, Einträge `py-1.5`, flache Liste nach `order`, „Administration“ aufklappbar und nach dem Laden zu), Kopfzeile `h-14`, Inhalt in `max-w`-freier
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
| Seitenkopf, Formularfeld, Leerzustand, Bestätigung | `PageHeader`, `FormField` (`label`, `id`, `hint`, `error`, `required`; `content-start`, damit Labels im Raster neben Feldern mit Hinweis auf einer Höhe bleiben), `EmptyState`, `ConfirmDialog` |
| Ladezustand / Fehlerzustand beim Laden | `LoadingState` (`label`, `rows`, `rowClass`, `variant` rows/text; Skeleton + `role="status"` + sr „Lädt …“) / `ErrorState` (`title`, `message`, `onretry`, `busy`, `compact`, `details`; „Erneut versuchen“). `DataTable` (`error` + `onretry`) und `DashboardCard` nutzen sie intern. Nach Ladefehler **nie** leere Daten rendern |
| Suche / Seitenwechsel (URL-basiert) | `SearchInput` (`param`, `resetParams`), `Pagination` (`pageParam`) |
| Einfachauswahl / Mehrfachauswahl mit Suche | `SelectField` (`ui/select-field`, `emptyLabel`, `name`) / `MultiSelect` (`ui/multi-select`) |
| Freie Tags/Schlagwörter (Chips, Vorschläge, „„x“ anlegen“) | `TagInput` (`ui/tag-input`; `bind:value: string[]`, `suggestions` oder `loadSuggestions(q)` (200 ms Debounce), `max` 20, `maxLength` 40, `label`, `invalid`, `describedby`, `onchange`; Enter/Komma legt an, Blur übernimmt, Backspace entfernt letzten; Logik `addTag()` in `tags.ts`) |
| Farbe | `ColorPicker` (`ui/color-picker`), `ColorBadge`, `EntityAvatar` |
| Verlauf / Hintergrund (einfarbig, linear, radial, Farbflecken) | `GradientEditor` (`ui/gradient-editor`; `bind:value: ThemeBackground` aus `$lib/appearance`, `label`, `presets?`; Farbpunkte ziehen/Pfeiltasten/Entf, Klick auf die Leiste fügt hinzu, 2–6 Punkte, Mesh 1–5 Flecken auf der Vorschau ziehbar; reine Hilfen `gradient.ts`, Test `appearance.test.ts`) |
| Icon wählen / per Name anzeigen (alle ~1.900 Lucide-Icons) | `IconPicker` (`ui/icon-picker`; `bind:value` = Name, Suche englisch + deutsch, Vorschläge nach Themen, „Alle Icons“ in 240er-Schritten, Pfeiltasten mit einem Tab-Stopp), `DynamicIcon` (`name`, `class`, `strokeWidth`, `fallback`); Daten lazy aus `$lib/sdk/icons` (eigener Chunk, `iconStore.ensure()`), deutsche Begriffe/Vorschläge in `sdk/icons/keywords-de.ts`. Nach Lucide-Update `node scripts/generate-icon-data.mjs` (Test `icon-data.test.ts` meldet es) |
| Regler mit festen Stufen (z. B. Aus · E-Mail · Beides · Push) | `SegmentedSlider` (`ui/segmented-slider`; `value`, `options: { value, label, disabled?, hint? }[]`, `label` (aria), `onchange`, `disabled`; bits-ui `RadioGroup`, gleitender Knopf, Pfeiltasten, gesperrte Stufen sichtbar) |
| Zahl mit −/+ , Regler, Geld | `NumberStepper`, `Slider` (`ui/slider`), `MoneyInput` (`money.ts`: `formatEuro`, `parseEuroToCents`) |
| Datei-Upload, Kontaktliste (stapelt unter 640 px) | `FileField`, `ContactListField` |
| Bild zuschneiden (Ausschnitt verschieben/zoomen) | `FileField crop={{ aspect?, shape?: 'rect'\|'circle', maxEdge?, title? }}` öffnet nach der Auswahl `ImageCropDialog`; `file` und `input.files` (native Formulare) enthalten danach den Ausschnitt (WebP, Safari JPEG), `maxBytes` gilt fürs Ergebnis, Original bis `CROP_SOURCE_MAX_BYTES` (25 MB), Link „Ausschnitt ändern“. Herauszoomen über das Bild hinaus bis `minZoom` (ganzes Bild halb so groß wie „passt hinein“), Ränder/Transparenz in der Hintergrundfarbe (`crop.background` = Startwert, im Dialog per `ColorPicker` änderbar, Standard Weiß; Checkbox „Transparent“ bzw. `background: 'transparent'` → keine Füllung, Schachbrett-Vorschau, WebP/PNG mit Alpha, `cropFill`). Rechnen in `layout/image-crop.ts` (`placement`, `outputFor`) (Rahmeneinheiten, Test `image-crop.test.ts`, E2E `image-crop.spec.ts`). Genutzt: Gruppenbild (rund, 1200 px, Hintergrund = Gruppenfarbe), Profilbild Profil + `/admin/users` (rund, 512 px) |
| Zusammenfassung, Kostenbalken | `SummaryList`, `CostBar` |
| Freigabe | `ShareMenu` (Popover im Seitenkopf), `ShareDialog`, `SharePanel`; Einträge/Kandidaten optional mit `type` (`everyone`/`group`/`role`/`user`/`member` → Icon + Badge), `detail` (Unterzeile statt E-Mail), `color` (Gruppenpunkt); Schlüssel `shareKey` (ohne `type` = Benutzer-ID, sonst `typ:id`, auch für `onchange`/`onremove`). Props `everyoneLabel` (Schnellknopf „… (alle)“ → `onadd({ id: '*', type: 'everyone' })`), `placeholder`, `searchLabel`, `emptyResultText` |
| Erfolgs-Toast mit „Rückgängig“ (Rückweg = vorhandener API-Aufruf) | `toastWithUndo({ message, undo, undone?, onundone? })` aus `$lib/components/layout` (früher `treasury/pages/undo.ts`) |
| Dashboard-Kachel eines Moduls | `ui.ts` `dashboardWidgets` (`DashboardWidget`, Props `DashboardWidgetProps { userId, size, onstatus }`) + `DashboardCard` (`$lib/components/layout`: title, icon, href „Alle anzeigen“, loading/error/empty, actions); nach dem Laden `onstatus('ready'|'empty')` melden. Muster: `events/pages/widgets/` |
| Profil-Abschnitt eines Moduls | `ui.ts` `profileSections` (Props `{ userId }`, Daten per `apiFetch`); Muster: `members/pages/ProfileMemberCard.svelte` (Entwurf + Speichern je Tab, kein Autosave, `beforeNavigate`-Warnung) |
| Overlay | `ui/dialog`, `ui/popover`, `ui/sheet`, `ui/dropdown-menu`, `ui/tooltip` |
| Kontextmenü (Rechtsklick an der Mausposition, Long-Press auf Touch) | `ContextMenu` (`ui/context-menu`, bits-ui `ContextMenu`; gleiche API wie `ui/dropdown-menu`: Root/Trigger/Content/Item/Separator/Sub …; Zustände über `data-[state=open]:`); Muster: `files/pages/FileList.svelte` (gemeinsames Snippet mit dem „…“-Menü) |
| Monatskalender (Raster Mo–So, 6 Wochen; mobil Agenda-Liste) | `MonthCalendar` (`items: CalendarItem[]` mit `startsOn`/`endsOn`/`startsTime`/`endsTime`/`color`, optional `recurring` (Wiederhol-Symbol, Titel „(Serie)“ im Label) und `key` (eindeutiger Schlüssel je Vorkommen, sonst `id`), `bind:month` `YYYY-MM`, `today?`, `onselect(item)`, `onday?(date)` → „+“-Knopf je Tag, `loading`); mehrtägige Termine als durchgehende Balken (Spuren je Woche, max. 3, sonst „+n weitere“-Popover), Schriftfarbe per `contrastTextColor`; Logik in `layout/month-calendar.ts` |
| Bestätigung per Eingabe eines Wortes (unumkehrbare Aktionen, z. B. `ZURÜCKSETZEN`) | `TypedConfirmField` (`$lib/components/layout/TypedConfirmField.svelte`; `word`, `bind:value`, `bind:confirmed` – true nur bei exakter, NFC-normalisierter Eingabe; `label?`, `hint?`, `id?`, `disabled?`). Danach destruktiver Button → `ConfirmDialog`; Muster: `/admin/reset` |
| Runder Zähler (ungelesen o. Ä.; 0 = nichts, ab 10 „9+“) | `CountBadge` (`count`, `max` = 9, `label` für Screenreader, `variant` primary/info); Formatierung `formatCount` (`layout/count.ts`); Seitenleiste über `navBadge` (siehe `modules.md`) |
| Reiterleiste aus Links (eigene URL je Reiter, aktiv = längster passender `href`, `aria-current`) | `LinkTabs` (`tabs: { label, href, icon? }[]`, `label` = zugänglicher Name der `nav`); Reiter der Verwaltung aus `adminTabs(parent, permissions)` |
| Befehlspalette (Strg/⌘+K, Topbar-Button „Suchen“) | `CommandPalette` (`permissions`, `navigation`, `bind:open`; Combobox „Seite oder Einstellung suchen“, Treffer über `searchAdmin`) – nur einmal in der `Topbar` |
**Neue Verwaltungsseite = Eintrag in `layout/admin-registry.ts`** (Abschnitt, Recht, Suchbegriffe, `nav` oder `parent` für Reiter) – Seitenleiste,
Übersicht `/admin`, Befehlspalette und Reiter lesen nur dort; keine Links von Hand in `nav.ts` oder Seiten pflegen. Route unter `src/routes/(internal)/admin/`.

Neue wiederverwendbare Bausteine kommen nach `components/layout` (fachlich) bzw. `components/ui` (generisch) und
werden in `docs/module-development.md` (Tabelle) und hier ergänzt.

## UX-Regeln
- Formulare: Label über dem Feld, Pflicht mit `*`, Fehler direkt darunter (`text-xs text-destructive`, `role="alert"`,
  `aria-invalid`, `aria-describedby`). **`FormField` erledigt das selbst** (Kontext `ui/field/context.ts`): `Input`, `Textarea`,
  `SelectField`, `MultiSelect`, `MoneyInput`, `NumberStepper`, `TagInput`, `ColorPicker` im Feld bekommen `aria-describedby`
  (Hinweis + Fehler), `aria-invalid` und bei `required` `aria-required` – sofern ihre `id` gleich der `FormField`-`id` ist (oder
  fehlt). Hinweis bleibt bei Fehler sichtbar. Eigene Angaben gewinnen (`aria-invalid`) bzw. werden zusammengeführt
  (`aria-describedby`); manuelle Verknüpfungen in Modulen sind damit überflüssig. Native Elemente ohne Core-Baustein
  verknüpfen weiterhin selbst (`{id}-hint`, `{id}-error`). Client-Validierung mit denselben Zod-Schemas wie der Server, erstes fehlerhaftes
  Feld fokussieren. Server-Fehler (`ApiClientError.details`) auf Felder abbilden, sonst im Dialog/Toast zeigen.
- Mutationen: Button `disabled` + Text „Speichert …“ während `busy`; Erfolg als `toast.success`, Fehler `toast.error`.
  Löschen immer mit `ConfirmDialog` (destruktiv); wo sinnvoll Rückgängig-Toast.
- Laden: `LoadingState` (Skeleton in Zielform, Text „Lädt …“), Fehlerzustand `ErrorState` mit „Erneut versuchen“,
  Leerzustand mit erklärendem Text und Aktion.
- Autosave (Kalkulation): Debounce ~800 ms, Statuszeile mit `aria-live` („Gespeichert“, „Speichert …“, Fehler + Retry),
  ausstehende Änderungen beim Verlassen flushen, Server-Antworten überschreiben keine laufende Eingabe.
- Berechnungen live und lokal (gleiche reinen Funktionen wie der Server), nie `NaN`, Eingaben klemmen statt abweisen.
- Rechte: Aktionen ohne Berechtigung **ausblenden** bzw. Felder `disabled` mit Hinweis „Nur Ansicht“.
- Mobil (≥ 360 px): einspaltig, Raster `grid-cols-1 sm:grid-cols-N` (nie festes `grid-cols-2/3` in Dialogen ohne `sm:`).
  **Tabellen**: `DataTable mobile="cards"` macht unter 640 px jede Zeile zur Karte (Beschriftung automatisch aus den `<th>`,
  Zellen ohne Kopftext = Checkbox/Aktionen). Für Listen mit vielen Spalten Standard; breite Summen-/Vergleichstabellen bleiben
  `mobile="scroll"` (Default, horizontales Scrollen). `max-w-*`/`truncate` in Zellen wird in Karten umgebrochen.
  **Bulk-Leisten** mit `MobileActionBar` (unten fixiert, Inhalt braucht `pb-20`). **Dialoge** haben Standard-`max-h-[calc(100dvh-2rem)]`
  mit Scroll; kein eigenes `vh` setzen (Guard). Lange Formulare: `Dialog.Footer sticky` (Fußzeile bleibt beim Scrollen sichtbar). **Touch-Ziele** ≥ 36 px werden auf Touch-Geräten (`pointer: coarse`) in `app.css`
  erzwungen (Button, Input, Select, Tabs-Trigger, Checkbox) – Desktop bleibt kompakt. Wichtige Summen als fixierte Leiste unten.
- Barrierefreiheit: Icon-Buttons mit `aria-label`, Gruppen mit `fieldset/legend`, Fokus sichtbar, Farbe nie alleiniger Träger.

## Fallen
- `Card` hat `overflow-hidden`: eigene, absolut positionierte Trefferlisten/Menüs in einer Karte werden abgeschnitten → `Card.Root class="overflow-visible"` oder portaliertes Overlay (`ui/popover`).
- **bits-ui setzt `data-state="open|closed|checked|unchecked|active"` und `data-orientation`.** shadcn-Vorlagen anderer
  Versionen nutzen `data-open:`/`data-checked:`/`data-horizontal:` → wirkungslos (unsichtbare Schalter, Tabs als Spalte).
  Immer `data-[state=open]:` / `data-[orientation=horizontal]:` verwenden; Vorlagen beim Einfügen anpassen.
- Kein natives `<select>`, `<input type="color">`, `<input type="checkbox">`, `<textarea>` (→ `Checkbox` mit `name`/`value` für
  Formular-POST, `Textarea`); `<input type="date">` nur dort, wo es bereits so gelöst ist (Datumsfelder).
- Generisches `SettingsForm` (`/admin/settings/*`): Feldart `color` (`COLOR_KEYS` in `admin/_shared/group-form.server.ts`) →
  `ColorPicker` + Vorschau + Kontrastanzeige; Beschreibungen über den `FormField`-Hinweis verknüpft.
- Svelte 5: `$props`, `$state`, `$derived`, `$bindable`; keine `$effect`-Ketten für abgeleitete Werte; Snippets statt Slots;
  Event-Attribute `onclick={…}`; `{#each … (key)}` immer mit Schlüssel.
- Popover/Dialog-Kombination: Inhalte werden portaliert; Select in Dialog funktioniert über die bits-ui-Layer.
- Tailwind v4: keine `tailwind.config.js`; Tokens in `app.css` (`@theme inline`).
