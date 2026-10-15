# EP Intern 2.0 – Projekthinweise für Claude

Selbst gehostete Verwaltungsplattform (SvelteKit 2 / Svelte 5, TypeScript strict, PostgreSQL, Drizzle,
Better Auth, Tailwind 4, shadcn-svelte/bits-ui) als **modularer Monolith**: ein kleiner **Core**
(Auth, Rechte, Module, Einstellungen, API, Storage, PDF, KI, Audit) plus **Fachmodule** unter
`src/lib/modules/<id>/`. Der Nutzer ist deutschsprachig; die Zielgruppe ist ein Pfadfinder-Stamm.

Die ausführliche Doku liegt in `docs/` (architecture, core-services, module-development, permissions,
api, database, deployment, security). **Diese Dateien hier sind die Kurzfassung für die Arbeit** –
bei Widerspruch gewinnt der Code, danach `docs/`.

## Regeldateien (werden automatisch geladen)

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

## Die zehn wichtigsten Regeln

1. **Nie „fertig“ melden ohne Verifikation**: check, eslint, prettier, tests, build; UI per Screenshot ansehen.
2. Module importieren nur `$lib/sdk/*` und `$lib/components/{ui,layout}` – nie `$lib/server/*`.
3. Berechtigungsschlüssel: `modul.ressource.aktion`, nur `[a-z0-9-]` (**keine Unterstriche**).
4. Core-Services (`core.users`, `core.audit`, `core.storage`, …) **nie innerhalb** `forModule(...).transaction`.
5. Migrationen sind additiv und unveränderlich: neue Datei, nie eine angewendete Migration ändern.
6. Geld immer als Integer-Cent, Datum als `YYYY-MM-DD`-String, IDs per `crypto.randomUUID()`.
7. bits-ui setzt `data-state` / `data-orientation` – **nie** `data-open:`/`data-checked:`/`data-horizontal:` in Tailwind-Klassen.
8. Keine nativen `<select>`/`<input type=color>`; Core-Bausteine nutzen (`SelectField`, `MultiSelect`, `ColorPicker` …).
9. Texte in der Oberfläche deutsch mit echten Umlauten; Server-Fehlertexte deutsch ASCII-transliteriert (ae/oe/ue).
10. Nichts committen oder pushen, solange der Nutzer es nicht verlangt. Demo-Server nie hart beenden (`.data/stop`).
