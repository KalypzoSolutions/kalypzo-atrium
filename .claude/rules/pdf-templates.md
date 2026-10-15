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
- Admin-Vorschau (`/pdf`, `/pdf/preview?template=<id>&only=<teil>`) nach jeder Änderung ansehen.
- Nutzereingaben **nie** als Roh-HTML ausgeben: immer `escapeHtml`; Adresszeilen begrenzen.
- Keine externen Requests (Schriften/Bilder als Data-URL oder lokale Assets).
- Neue Vorlage: Test ergänzen, Doku in `docs/core-services.md` (Abschnitt Briefvorlagen) aktuell halten.
