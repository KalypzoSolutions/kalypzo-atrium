---
paths: ["src/lib/server/core/pdf/**", "modules/ep-stamm/**"]
---

# PDF-/Briefvorlagen

- Vorlagen sind Code: eine Datei je Vorlage in `src/lib/server/core/pdf/templates/` (`export default` ein
  `PdfTemplate`), Bausteine in `parts/`, Schriften/Bilder in `assets/` (Carlito, OFL, eingebettet).
- Core ist **neutral** (Kalypzo Atrium Phase N): `brief`, `briefkopf`, `briefkopf-quer` aus `parts/letter.ts` (`createLetterTemplate`), Kopf =
  Name der Organisation + Logo, Fußzeile = `core.pdf.footerText` bzw. Kontaktdaten. Alte IDs `stamm-*` sind Aliase (`TEMPLATE_ALIASES`).
  Organisationsspezifisches Aussehen kommt aus Modulen (`ModuleDefinition.pdfTemplates`, gleiche ID ersetzt die Core-Vorlage bei aktivem
  Modul, `resolveTemplate` in `pdf/resolve.ts`); der Stamm-Briefkopf (Lilie, Vereinsname, Wappen, Vereinsnachweis) liegt in `modules/ep-stamm`.
- Texte der Core-Vorlagen und Bestandteile als Schlüssel `pdf.templates.*`/`pdf.parts.*` (übersetzt in `describeTemplate`); Fehler über `t('pdf.errors.*')`.
- Alle Maße in **mm** von der oberen linken Seitenecke; Position/Größe der Bestandteile auch in `parts` eintragen
  (Anzeige in der Admin-Ansicht).
- Referenzbild des Stamm-Briefkopfs liegt unter `docs/reference/` (`briefkopf_stamm_adressfeld_page_1.png`); `ep-stamm` dagegen abgleichen:
  Chromium-Screenshot und `pdftotext -bbox` für Textpositionen.
- Chromium: Overlay per `position: fixed` (wiederholt sich je Seite); `page` setzt Format/Ränder und schaltet Kopf/Fuß ab.
- Querformat: `page.orientation: 'landscape'` und `createLetterTemplate({ …, orientation: 'landscape' })`; Maße aus
  `letterGeometry('landscape')`/`GEOMETRY_LANDSCAPE` (`mark`, `title`, `emblem`, `footer`), Bestandteile aus `PART_META_LANDSCAPE`. Kein Adressfeld im
  Querformat (`withAddress` wirft). Vorlagen mit festem Layout bestimmen die Ausrichtung selbst.
- Admin-Vorschau (`/admin/settings/pdf`, `/admin/settings/pdf/preview?template=<id>&only=<teil>`) nach jeder Änderung ansehen.
- Tabellen (`renderGridTable`/`placeRows` in `templates.ts`): Linien nie als `border` unter 1 px (Chromium rundet auf 1 px auf),
  sondern als `box-shadow:0 0 0 0.5px` je Zelle (Außenrahmen 0,5 px, Innenlinien 1 px). Zellen zusammenfassen über
  `PdfTableCell` (`colspan`/`rowspan`) statt leerer Platzhalterzellen (`''`); Tests: `tests/unit/pdf-table.test.ts`.
  Linienstärke im PDF per Chromium-Screenshot mit `deviceScaleFactor: 3` prüfen (Beispiel: HTML aus `renderBlocks` + `baseCss`).
- Nutzereingaben **nie** als Roh-HTML ausgeben: immer `escapeHtml`; Adresszeilen begrenzen.
- Einzige Ausnahme: Block `richText` (`{ type: 'richText', html }`, z. B. Notiz-Export) – `renderRichText` bereinigt **immer** mit
  `sanitizeDocumentHtml` (`$lib/sdk/server/html.ts`, Allowlist: Tags `DOCUMENT_TAGS`, Styles nur Farbe/Hintergrund/Schriftgröße/Ausrichtung/Breite,
  Bilder nur `data:image/(png|jpeg|webp|gif)` ≤ 10 MB, Links http/https/mailto), gesamt ≤ 40 MB; Druck-CSS `RICH_TEXT_CSS` (`.rich-text`).
  Test `tests/unit/pdf-rich-text.test.ts`. Neue erlaubte Tags/Styles nur dort ergänzen und testen.
- Keine externen Requests (Schriften/Bilder als Data-URL oder lokale Assets).
- Neue Vorlage: Test ergänzen, Doku in `docs/core-services.md` (Abschnitt Briefvorlagen) aktuell halten.
