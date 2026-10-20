---
paths: ["website/**", "scripts/seed-demo-website.mjs", "src/lib/modules/*/website.endpoints.ts", "tests/**/*website*"]
---

# Stammeswebsite (`website/`)

**Stand 2026-10-19 (Nutzerentscheidung):** `website/` ist die **alte Website** aus
`https://github.com/CrayonGamerHD-Philipp/edelweisspiraten-website` (Ordner `web/`, Stand `ba0b441`), bei der **nur das Backend
getauscht** ist: statt PocketBase holt sie Termine und Galerien **serverseitig** aus den Website-Endpunkten des Intern-Bereichs.
Design, Texte und Seitenaufbau der alten Seite bleiben unverändert – keine Neugestaltung ohne ausdrücklichen Auftrag.
(Die zwischenzeitlich neu gebaute Website mit Figuren/Motiven wurde verworfen; sie steht noch in der Git-Historie.)

## Grundregeln
- Eigenes Projekt (`package.json` „web“, SvelteKit 2 / Svelte 5 im **Legacy-Modus** mit `export let`, Tailwind 4, `adapter-node`, Port 3001,
  `Dockerfile`, `.dockerignore`). Root-Werkzeuge ignorieren `website/`. Die Website importiert **nichts** aus `src/`.
- Befehle im Ordner `website/`: `npm run dev` / `npm run check` / `npm run build`, Start `WEBSITE_API_KEY=… PORT=3001 node build`.
  `npm run check` meldet **5 Fehler + Warnungen aus dem alten Code** (Leaflet-Typen, implizites `any`, `keepfocus`, a11y) – bekannt,
  nicht neu einführen. Es gibt kein `lint`/`test`.
- Der API-Key steht **nur** in `WEBSITE_API_KEY` (Server). Nie im Browser abfragen: Daten über `+page.server.ts` bzw. Server-Routen.
- Änderungen an den Website-DTOs im Backend (`WebsiteEvent`, `WebsiteGallery*`, `WebsiteGroup`) in `website/src/lib/server/backend.ts`
  nachziehen (Typen dort als Auszug).

## Umgebung (`website/.env`, Vorlage `.env.example`)
| Variable | Bedeutung |
|---|---|
| `WEBSITE_API_URL` | Basis-URL des Intern-Bereichs, serverseitig (Standard `http://app:3000`, Demo `http://127.0.0.1:4300`) |
| `WEBSITE_API_KEY` | Key mit `events.website.read galleries.website.read members.website.read` |
| `ORIGIN` | öffentliche Adresse (adapter-node, CSRF) |

Compose (`docker-compose.yml`, `docker-compose.dokploy.yml`): Dienst `website` mit `WEBSITE_API_URL: http://app:3000`,
`WEBSITE_API_KEY: ${WEBSITE_API_KEY}`, `ORIGIN: ${WEBSITE_ORIGIN}`.

## Backend-Anbindung (`src/lib/server/backend.ts`)
- `getJson` (nur Pfade `/api/v1/modules/<x>/website/…`, Bearer-Key, Timeout 5 s, Cache 60 s, bei Fehler letzter Stand), `fetchImage`.
- Liefert die **PocketBase-Form**, die die Seiten kennen: `Appointment { id, title, description, date, end_date, location, pictures,
  tags, expand: { tags: Tag[] } }`.
  - `date`/`end_date` = lokale Zeit `YYYY-MM-DDTHH:MM:00` aus `startsOn`/`startsTime`.
  - **Serien**: jedes Vorkommen einzeln, `id = <id>~<YYYY-MM-DD>`; `/termine/[id]` zerlegt das wieder (`occurrence`).
  - `expand.tags` = Gruppen (`g:<groupId>`, Farbe aus `members/website/groups`) + Themen-Tags (`t:<name>`, ohne Farbe).
  - `pictures` = Bild-URLs `/bilder/galerie/<galleryId>/<imageId>/web` aus allen Galerien, die mit dem Termin verknüpft sind.
- `fetchAppointments()` (2023 bis Ende nächsten Jahres, Halbjahres-Abrufe à 200), `fetchAppointmentById`, `collectTags`,
  `fetchUpcomingForGroup(slug)`, `fetchGalleryAppointments()` (Galerien als „Termine mit Bildern“, `pictures[0]` = Titelbild `thumb`,
  Datum = frühester verknüpfter Termin), `fetchGalleryAppointment(id)`.

## Seiten und Routen
| Route | Quelle |
|---|---|
| `/` | FAQ fest in `src/lib/faqs.ts` (früher PocketBase `faqs`); Ferienhinweis statisch im Markup; Gruppenkarten aus dem Backend |
| `/termine`, `/termine/[id]` | `+page.server.ts` → `fetchAppointments` / `fetchAppointmentById` (404 unbekannt, 503 Backend weg) |
| `/galerie`, `/galerie/[id]` | `+page.server.ts` → `fetchGalleryAppointments` / `fetchGalleryAppointment` (ID = Galerie-ID) |
| `/meute/[slug]`, `/sippe/[slug]` | **aus dem Intern-Bereich** (`fetchGroup`, gemeinsamer Loader `lib/server/group-page.ts`, Vorlage `GroupPage.svelte` im Aufbau der alten Meute-Seite; Gruppenfarbe statt fester Farben). Falscher Typ → 308 auf `/<type>/<slug>`; `/meute` → 307 auf die erste Meute. `AppointmentPreview` (`gruppe` = Titel, `slug`) lädt per `fetch('/api/termine?gruppe=<slug>')` |
| Menü, Startseite („Unsere Gruppen“, `#gruppen`), Kontakt (Gruppen-Ansprechpartner) | `data.groups` aus `+layout.server.ts` (`fetchGroups`, ohne Backend leere Liste); Ämter auf `/kontakt` bleiben statisch |
| `/bilder/gruppe/[slug]` | Bild-Proxy fürs Gruppenbild; ohne Bild im Backend nimmt `toGroup` das alte statische Bild je Slug |
| `/api/termine` | Server-Route: nächste 3 Termine der Gruppe (`fetchUpcomingForGroup`) |
| `/bilder/galerie/[id]/[imageId]/[variant]` | Bild-Proxy (`thumb`/`web`), `public, max-age=3600` |
| `/download[/…]` | **entfernt** (Nutzerentscheidung) → 308 auf `/` (`src/hooks.server.ts`), Menüpunkt gelöscht |
| `/kontakt`, `/cpd`, `/impressum`, `/datenschutz` | statisch wie früher |

Gruppen erscheinen, wenn sie im Intern-Bereich „auf der Website“ stehen (Gruppendialog → Reiter Website: Slug, Text, Alter, Kontakt-E-Mail;
Allgemein: Wochentag, Uhrzeit, Ende, Treffpunkt, Farbe; Leitung nur mit Vornamen). Für alte Links die Slugs `sportliche-panther`, `funkelfuechse`,
`die-goldenen-loewenzaehne` beibehalten. `prerender` ist aus (`+layout.js`), weil jede Seite die Gruppen zur Laufzeit lädt.

## Demo
```bash
npm run build && node scripts/demo-server.mjs   # :4300
node scripts/seed-demo-website.mjs              # Gruppen/Slugs, Termine, Galerie, API-Key → website/.env (WEBSITE_API_*)
cd website && npm run build && PORT=3001 node --env-file=.env build
```

## Offen
- Datenschutztext, Ferienhinweis (statisch, Termine darin veraltet) und FAQ-Texte pflegen sich nur im Code.
- Wöchentliche Gruppenstunden erscheinen auf `/termine` als einzelne Kacheln (die alte Seite kannte keine Serien).
- Galerie-Datum `toLocaleDateString()` ohne Locale (alter Code) → Format hängt vom Browser ab.
- Altes `ecosystem.config.cjs` (PM2) unverändert übernommen, ungeprüft.
