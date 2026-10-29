---
name: awesome-design
description: >-
  Bibliothek mit 84 DESIGN.md-Analysen bekannter Marken-Designsysteme (Linear, Stripe, Vercel, Notion,
  Apple, Airbnb, Supabase, Raycast, Figma …) aus VoltAgent/awesome-design-md: Farben, Typografie,
  Abstände, Radien, Komponenten und Tonalität als Tokens + Fließtext. Nutzen, wenn eine Oberfläche
  „wie <Marke>“ aussehen soll, für Inspiration zu Farbpaletten/Typo/Komponenten, beim Vergleich von
  Gestaltungsrichtungen oder wenn ein Konzept/Redesign Referenzen braucht.
---

# Awesome Design (DESIGN.md-Sammlung)

Quelle: https://github.com/VoltAgent/awesome-design-md (Stand `fcc7028`, Lizenz siehe `LICENSE`).
Jede Marke liegt unter `design-md/<marke>/DESIGN.md` (YAML-Frontmatter mit Tokens: `colors`, Typografie,
Abstände, Radien, Schatten … plus erklärender Text) und `README.md` (Kurzbeschreibung).

## Vorgehen

1. Passende Referenz wählen: `ls design-md/` bzw. die `description` im Frontmatter der Kandidaten lesen
   (`head -12 design-md/*/DESIGN.md`). Bei offener Wahl 2–3 Kandidaten mit einem Satz Begründung vorschlagen.
2. Die gewählte `DESIGN.md` **ganz** lesen, bevor gestaltet wird.
3. Übertragen, nicht kopieren: Prinzipien (Kontrast, Akzent-Sparsamkeit, Typo-Skala, Dichte, Radien,
   Flächen statt Rahmen …) auf das Projekt anwenden. Markenzeichen, Logos, Markennamen und eigene Schriften
   der Marke **nicht** übernehmen.

## In diesem Projekt (EP Intern 2.0)

- Projektregeln gehen vor: `.claude/rules/ui-design.md` (Design-Tokens, Core-Bausteine, bits-ui-Fallen),
  Tailwind 4 + shadcn-svelte. Farben aus einer DESIGN.md als **Token-Vorschlag** formulieren
  (CSS-Variablen in Hell **und** Dunkel), keine festen Hex-Werte in Komponenten.
- Für die Stammeswebsite (`website/`) gilt zusätzlich `.claude/rules/website.md`.
- Gut kombinierbar mit `design-taste-frontend` (Art Direction) und `web-design-guidelines` (Review).
