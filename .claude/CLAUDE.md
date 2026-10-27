# EP Intern 2.0 – Projekthinweise für Claude

Selbst gehostete Verwaltungsplattform (SvelteKit 2 / Svelte 5, TypeScript strict, PostgreSQL, Drizzle,
Better Auth, Tailwind 4, shadcn-svelte/bits-ui) als **modularer Monolith**: ein kleiner **Core**
(Auth, Rechte, Module, Einstellungen, API, Storage, PDF, KI, Audit) plus **Fachmodule** unter
`src/lib/modules/<id>/`. Der Nutzer ist deutschsprachig; die Zielgruppe ist ein Pfadfinder-Stamm.

Die ausführliche Doku liegt in `docs/` (architecture, core-services, module-development, permissions,
api, database, deployment, security). **Diese Dateien hier sind die Kurzfassung für die Arbeit** –
bei Widerspruch gewinnt der Code, danach `docs/`.

## Regeldateien (werden automatisch geladen)

Modul- und Bereichsregeln (`module-*.md`, `website.md`, `ui-design.md` …) laden per `paths:`-Frontmatter nur bei passenden Dateien.
**Neue Regeldateien immer mit `paths:` anlegen** – sonst reißen die immer geladenen Anweisungen das Limit von 150k Zeichen.

| Datei | Inhalt |
|---|---|
| `rules/architecture.md` | Schichten, Request-Fluss, Core-Objekt, DB-Isolation, Fehler/Audit |
| `rules/modules.md` | Checkliste und Muster für Fachmodule, häufige Fallen |
| `rules/ui-design.md` | Design-System, Komponenten-Inventar, UX-Regeln, bits-ui-Fallen |
| `rules/pdf-templates.md` | PDF-/Briefvorlagen im Code |
| `rules/forms.md` | Entwurf des wiederverwendbaren Formular-Builders |
| `rules/testing-and-verification.md` | Was vor „fertig“ laufen muss, Testmuster |
| `rules/workflow.md` | Demo-Server, Screenshots, Agents, Git, Kommunikation |
| `rules/module-members.md` | Modul Mitglieder & Gruppen: Dateien, Datenmodell, Rechte, API, Regeln |
| `rules/module-actions.md` | Modul Aktionen: Kalkulation, Zuschuss, Anmeldelink, Abrechnung, Rückzahlung, PDF-Bericht |
| `rules/module-treasury.md` | Modul Kasse: Konten, Buchungen, Rechnungen aus Aktionen, Zuordnung/Geschwister, Import, Mails, Berichte |
| `rules/module-events.md` | Modul Termine: Termine, Tags, Gruppen-Zuordnung, Freigabe an Principals, Website-API |
| `rules/module-galleries.md` | Modul Galerien: Bilder, Titelbild, Freigabe/öffentlich, Termin-Zuordnung, Website-API, `core.images` |
| `rules/module-messages.md` | Modul Nachrichten: E-Mails an Mitglieder/Gruppen, Editor, Anhänge, Absender (persönlich/Amt/Gruppe/Stamm), Versand, Verlauf |
| `rules/module-offices.md` | Modul Ämter: Reihenfolge, E-Mails, Inhaber*innen, Rollen aus Ämtern (`user_role_grant`), Bio, Website-API |
| `rules/module-orders.md` | Modul Bestellungen: Artikel/Größen/Bilder, Bestellen mit Rechnung über die Kasse, Ausgabe, Lager, Einkauf mit Teillieferung |
| `rules/module-files.md` | Modul Dateien: eine Ansicht (eigene + Freigegebenes), Upload/Drag & Drop, Rechtsklick, Vorschau, Freigabe an Principals/Stamm, öffentliche Ansicht-/Upload-Links, Papierkorb, Kontingent, Sicherheitsregeln |
| `rules/module-tasks.md` | Modul Aufgaben: Kanban-Boards, Spalten, Aufgaben mit Zuständigen/Fälligkeit/Priorität, Unteraufgaben, Freigaben, Board je Aktion |
| `rules/module-website.md` | Modul Website: Banner/Hinweise, FAQ, Blog (Bilder im Text, Mitschreiben, geplantes Veröffentlichen), Website-API `website.content.read` |
| `rules/module-material.md` | Modul Material: Bestand (Orte, Kisten, Stücke, Mengen), Zelt-Sets, Reservierungen mit Bahnen-Anfrage, Ausgabe/Rückgabe per Scan, Etiketten-Designer/-Druck |
| `rules/module-whiteboard.md` | Modul Whiteboards: Live-Bearbeitung (SSE + Ops, zuletzt geschrieben gewinnt), Formen/Verbinder/Freihand/Rahmen, Bilder/Dateien, Karten aus Modulen, Versionen, Export PNG/SVG/PDF/Archiv, Touch |
| `rules/website.md` | Stammeswebsite `website/` = alte Website mit neuem Backend (`WEBSITE_API_KEY`): Anbindung, Routen, Demo |
| `rules/project-state.md` | Stand, getroffene Entscheidungen, offene Punkte |

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run check` | `svelte-kit sync` + `svelte-check` (0 Fehler Pflicht) |
| `npx eslint .` / `npx prettier --check src tests docs` | Lint / Format (Tabs, Single Quotes, 100 Zeichen) |
| `npm test` (`npx vitest run`) | Unit + Integration (PGlite, ohne Docker) |
| `npm run build` | Produktions-Build nach `build/` |
| `npx playwright test` | E2E (baut selbst und startet eigene PGlite-Instanz) |
| `node scripts/demo-server.mjs` | Demo-App auf http://localhost:4300 (`admin@demo.test` / `Demo-Admin-2026!`) |
| `node scripts/screenshots.mjs …` | Screenshots für visuelle Prüfung (siehe `rules/workflow.md`) |
| `cd website && npm run check && npm run build` | Stammeswebsite prüfen/bauen (eigenes Projekt; 3 bekannte Altfehler, siehe `rules/website.md`) |
| `node scripts/seed-demo-material.mjs` | Material-Demodaten (Orte, Zelte/Sets, Kisten, Reservierungen, Etikett-Layouts) |
| `node scripts/seed-demo-whiteboard.mjs` | Whiteboard-Demodaten (aktiviert das Modul, Beispiel-Board mit Aktions-Karte) |
| `node scripts/seed-demo-website.mjs` | Website-Demodaten + API-Key → `website/.env`; Start `cd website && node --env-file=.env build` (:3001) |

## Die zehn wichtigsten Regeln

1. **Nie „fertig“ melden ohne Verifikation**: check, eslint, prettier, tests, build; UI per Screenshot ansehen.
2. Module importieren nur `$lib/sdk/*` und `$lib/components/{ui,layout}` – nie `$lib/server/*`.
3. Berechtigungsschlüssel: `modul.ressource.aktion`, nur `[a-z0-9-]` (**keine Unterstriche**).
4. Core-Services (`core.users`, `core.audit`, `core.storage`, …) **nie innerhalb** `forModule(...).transaction`.
5. Migrationen sind additiv und unveränderlich: neue Datei, nie eine angewendete Migration ändern.
6. Geld immer als Integer-Cent, Datum als `YYYY-MM-DD`-String, IDs per `crypto.randomUUID()`.
7. bits-ui setzt `data-state` / `data-orientation` – **nie** `data-open:`/`data-checked:`/`data-horizontal:` in Tailwind-Klassen.
8. Keine nativen `<select>`/`<input type=color>`; Core-Bausteine nutzen (`SelectField`, `MultiSelect`, `ColorPicker` …).
9. Alle deutschen Texte mit echten Umlauten und ß (UTF-8): Oberfläche, Server-Fehlertexte, Mails, Kommentare. ASCII bleibt nur in
   Bezeichnern, Schlüsseln, Pfaden/Slugs, Dateinamen und angewendeten SQL-Migrationen.
10. Nichts committen oder pushen, solange der Nutzer es nicht verlangt. Demo-Server nie hart beenden (`.data/stop`).
