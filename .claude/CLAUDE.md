# Kalypzo Atrium (Core) – Projekthinweise für Claude

Selbst gehostete Verwaltungsplattform (SvelteKit 2 / Svelte 5, TypeScript strict, PostgreSQL, Drizzle,
Better Auth, Tailwind 4, shadcn-svelte/bits-ui) als **modularer Monolith**: dieses Repo ist der neutrale, zweisprachige
**Core** (Auth, Rechte, Module, Einstellungen, API, Storage, PDF, KI, Audit). **Fachmodule** liegen in eigenen Repos
(z. B. `ep-intern-modules`) und werden per Panel installiert oder über `ATRIUM_MODULES_DIR` eingebunden; `modules/` ist hier leer.
Der Nutzer ist deutschsprachig.

Die ausführliche Doku liegt in `docs/` (architecture, core-services, module-development, permissions,
api, database, deployment, security). **Diese Dateien hier sind die Kurzfassung für die Arbeit** –
bei Widerspruch gewinnt der Code, danach `docs/`.

## Regeldateien (werden automatisch geladen)

Bereichsregeln (`ui-design.md`, `pdf-templates.md` …) laden per `paths:`-Frontmatter nur bei passenden Dateien.
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
| `rules/project-state.md` | Stand, getroffene Entscheidungen, offene Punkte |

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run check` | `svelte-kit sync` + `svelte-check` (0 Fehler Pflicht) |
| `npx eslint .` / `npx prettier --check src tests docs` | Lint / Format (Tabs, Single Quotes, 100 Zeichen) |
| `npm test` (`npx vitest run`) | Unit + Integration (PGlite, ohne Docker), Core + alle Module |
| `npm run test:core` / `npm run check:core` | Core allein mit Fixture-Modulen (`tests/fixtures/modules`) – muss grün sein |
| `npm run build` | Produktions-Build nach `build/` |
| `npx playwright test` | E2E (baut selbst und startet eigene PGlite-Instanz) |
| `node scripts/demo-server.mjs` | Demo-App auf http://localhost:4300 (`admin@demo.test` / `Demo-Admin-2026!`) |
| `node scripts/screenshots.mjs …` | Screenshots für visuelle Prüfung (siehe `rules/workflow.md`) |
| `code-review-graph status` / `update` / `build` | Code-Graph (SQLite in `.code-review-graph/`, gitignored) anzeigen / inkrementell / komplett neu |

## Code-Graph (code-review-graph, MCP)
MCP-Server `code-review-graph` (`.mcp.json`, Python-Paket `code-review-graph`) kennt Symbole, Aufrufe, Importe und Tests aller
getrackten Dateien (TS, Svelte, JS, SQL). **Vor** breitem Grep/Lesen für Struktur-Fragen nutzen: `semantic_search_nodes_tool`
(Symbol finden), `query_graph_tool` (Aufrufer/Aufgerufene/Importe/Tests), `get_impact_radius_tool` (Auswirkung einer Änderung),
`get_review_context_tool`/`detect_changes_tool` (Review des aktuellen Diffs). Skills: `explore-codebase`, `review-changes`,
`debug-issue`, `refactor-safely`. Hook in `.claude/settings.json` aktualisiert den Graphen nach Edit/Write; Code selbst danach
trotzdem lesen – der Graph ersetzt keine Verifikation.

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
   Bezeichnern, Schlüsseln, Pfaden/Slugs, Dateinamen und angewendeten SQL-Migrationen. **Im Core (`src/**`) keine festen Texte**: alles über
   `t()` mit de **und** en (`src/lib/i18n/messages`), neutral ohne Organisation (Wächter `i18n-guard`, siehe `architecture.md` → Mehrsprachigkeit).
10. Nichts committen oder pushen, solange der Nutzer es nicht verlangt. Demo-Server nie hart beenden (`.data/stop`).
