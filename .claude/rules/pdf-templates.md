---
paths: ["src/lib/server/core/pdf/**"]
---

# PDF-/Briefvorlagen

- Vorlagen sind Code: eine Datei je Vorlage in `src/lib/server/core/pdf/templates/` (`export default` ein
  `PdfTemplate`), Bausteine in `parts/`, Schriften/Bilder in `assets/` (Carlito, OFL, eingebettet).
- Alle Maße in **mm** von der oberen linken Seitenecke; Position/Größe der Bestandteile auch in `parts` eintragen
  (Anzeige in der Admin-Ansicht).
- Referenzbild liegt unter `docs/reference/` (z. B. `briefkopf_stamm_adressfeld_page_1.png`); Vorlage dagegen abgleichen:
  Chromium-Screenshot und `pdftotext -bbox` für Textpositionen.
- Chromium: Overlay per `position: fixed` (wiederholt sich je Seite); `page` setzt Format/Ränder und schaltet Kopf/Fuß ab.
- Querformat: `page.orientation: 'landscape'` und `createStammTemplate({ …, orientation: 'landscape' })`; Maße aus
  `stammGeometry('landscape')`/`GEOMETRY_LANDSCAPE`, Bestandteile aus `PART_META_LANDSCAPE`. Kein Adressfeld im
  Querformat (`withAddress` wirft). Vorlagen mit festem Layout bestimmen die Ausrichtung selbst.
- Admin-Vorschau (`/pdf`, `/pdf/preview?template=<id>&only=<teil>`) nach jeder Änderung ansehen.
- Tabellen (`renderGridTable`/`placeRows` in `templates.ts`): Linien nie als `border` unter 1 px (Chromium rundet auf 1 px auf),
  sondern als `box-shadow:0 0 0 0.5px` je Zelle (Außenrahmen 0,5 px, Innenlinien 1 px). Zellen zusammenfassen über
  `PdfTableCell` (`colspan`/`rowspan`) statt leerer Platzhalterzellen (`''`); Tests: `tests/unit/pdf-table.test.ts`.
  Linienstärke im PDF per Chromium-Screenshot mit `deviceScaleFactor: 3` prüfen (Beispiel: HTML aus `renderBlocks` + `baseCss`).
- Nutzereingaben **nie** als Roh-HTML ausgeben: immer `escapeHtml`; Adresszeilen begrenzen.
- Keine externen Requests (Schriften/Bilder als Data-URL oder lokale Assets).
- Neue Vorlage: Test ergänzen, Doku in `docs/core-services.md` (Abschnitt Briefvorlagen) aktuell halten.
