---
paths: ["website/**", "scripts/seed-demo-website.mjs", "src/lib/modules/*/website.endpoints.ts", "tests/**/*website*"]
---

# Stammeswebsite (`website/`)

Öffentliche Website des Stammes als **eigene SvelteKit-App** im Ordner `website/` (seit 2026-10-19). Ersetzt die alte Website
(`CrayonGamerHD-Philipp/edelweisspiraten-website`, PocketBase entfällt) und holt alle veränderlichen Inhalte **serverseitig per
API-Key** aus den Website-Endpunkten des Intern-Bereichs (`events`, `galleries`, `offices`, `members`). **FAQ und Downloads entfallen
vorerst** (`/download` → 308 auf `/`). API-Seite: `docs/api.md` → „Stammeswebsite“; Deployment: `docs/deployment.md` → „Stammeswebsite“.

## Grundregeln
- **Eigenes Projekt**: eigene `package.json` (`ep-website`), `package-lock.json`, eslint/prettier/tsconfig (Tabs, Single Quotes, 100 Zeichen,
  `noUncheckedIndexedAccess`), vitest; SvelteKit 2 / **Svelte 5 Runes**, Tailwind 4, `adapter-node` (Port **3001**), `website/Dockerfile`.
  Befehle **im Ordner `website/`**: `npm run dev` / `check` / `lint` / `test` / `build`, Start `PORT=3001 node --env-file=.env build`.
- Root-Werkzeuge ignorieren `website/` (`eslint.config.js`, `.prettierignore`, `.dockerignore`; Root-tsconfig/vitest erfassen es nicht).
- Die Website importiert **nichts** aus `src/`. DTOs sind in `website/src/lib/server/types.ts` **dupliziert** (Quellen im Kommentar) –
  Änderungen an `WebsiteEvent`, `WebsiteGallery*`, `WebsiteOffice`, `WebsiteGroup` immer auf **beiden** Seiten nachziehen.
- Deutsch mit echten Umlauten; keine nativen Selects (Filter als Link-Chips `FilterChip`, Zustand in der URL); kein Dunkelmodus.
- Nutzertexte nie per `{@html}` (Umbrüche per `whitespace-pre-line`); Farben aus der API in `style:` nur über `safeColor` (`format.ts`).
- Design-Tokens in `src/app.css` (`@theme`): `brand-50…950`, `ink`, `muted`, `canvas`, `surface`, `line`, `rounded-card`, `shadow-card`;
  Utilities `container-page`, `section-y`, `eyebrow`, `link`, `prose-site`, `btn btn-primary|btn-secondary|btn-ghost`.

## Umgebung (`website/.env`, Vorlage `.env.example`)
| Variable | Bedeutung |
|---|---|
| `INTERN_API_URL` | Basis-URL des Intern-Bereichs, serverseitig erreichbar (Demo `http://127.0.0.1:4300`) |
| `INTERN_API_KEY` | **ein** Key mit `events.website.read galleries.website.read offices.website.read members.website.read` |
| `PUBLIC_SITE_URL` | öffentliche Adresse (Canonical, Teilen, Rücksprung des Kontaktformulars) |
| `ORIGIN` | für `adapter-node`, i. d. R. = `PUBLIC_SITE_URL` |
| `INTERN_CACHE_TTL` | optional, JSON-Cache in Sekunden (Standard 60) |
| `IMAGE_CACHE_MB` | optional, Bild-Cache im Speicher (Standard 100, `0` = aus) |

## Datenzugriff (`src/lib/server/`)
- `intern-client.ts` (testbar, ohne `$env`) / `intern.ts`: `listEvents`, `getEvent(id, occurrence)`, `listGalleries`, `getGallery`, `listOffices`,
  `listGroups`, `getGroup(slug)` (404 → `null`, außer `module_disabled` = Ausfall), `safe(promise, fallback)` → `{ value, error }` (Seite rendert
  mit `Notice` statt 500). Timeout 5 s, TTL-Cache 60 s (≤ 500 Einträge), **Stale-on-Error**, Zusammenlegung gleicher Anfragen, nur Pfade
  `/api/v1/modules/<x>/website/…`. Fehlende Env → 503 `not_configured` + einmal Log.
- `image-proxy.ts`: LRU-Bild-Cache (100 MB, TTL 1 h, nur 200er ≤ 5 MB, `x-cache: HIT|MISS`), nur `image/*`. Grund: Rate-Limit 600 Bilder/60 s je Key.
- Layout-Load: `data.groups` / `data.groupsError` auf allen Seiten (Navbar-Dropdown, Gruppenlinks).

## Seiten
| Seite | Quelle / Verhalten |
|---|---|
| `/` | Hero, Über uns, Gruppenkarten (`data.groups`), `UpcomingEvents` (4 nächste Vorkommen inkl. Serien), Kontakt-Teaser; **ohne FAQ** |
| `/termine` | `listEvents` heute + 365 Tage in Quartals-Blöcken (je ≤ 200, dedupliziert – Serien würden ein einzelnes Limit füllen), Filter `?tag=`, `?gruppe=` (Slug, ID oder `stamm`) auf der Seite, Rückblick `?rueckblick=JJJJ` (bis 2023); Serien als „Regelmäßige Termine“ zusammengefasst, `?serien=alle` zeigt jedes Vorkommen |
| `/termine/[id]` (`?am=YYYY-MM-DD`) | `getEvent` + verknüpfte Galerien (`listGalleries({ eventId })`), Teilen, OSM-Link; 404/503 |
| `/galerie` (`?jahr=`, `?seite=`) | alle öffentlichen Galerien (Seiten zu 24 auf der Seite), Datum = frühester verknüpfter Termin, sonst `updatedAt` |
| `/galerie/[id]` (`?bild=<imageId>`) | Raster `thumb`, `Lightbox` (`web`, Tastatur/Wischen, Fokusfalle, Deep-Link serverseitig offen) |
| `/gruppen`, `/gruppen/[slug]` | Übersicht Meute/Sippe; Steckbrief (Leitung Vornamen, `formatMeeting`, Ort, Alter), Bild (API, sonst statisches Altbild je Slug), Kontakt, 3 Termine (`group`), Karte |
| `/kontakt` | Treffpunkt + Karte, Ämter aus `listOffices` (Avatar über Proxy, sonst Initialen), Formular an formsubmit.co (`FORM_RECIPIENT`) |
| `/cpd`, `/impressum`, `/datenschutz` | statisch aus der alten Website |

## Bild-Proxys (`src/routes/bilder/…`, Helfer `$lib/images.ts`)
`/bilder/galerie/[id]/[imageId]/(thumb|web)`, `/bilder/amt/[userId]`, `/bilder/gruppe/[slug]` (`?v=` aus `imagePath`) → `public, max-age=3600,
stale-while-revalidate=86400`, `nosniff`; 404 wird durchgereicht. Im HTML stehen nur Proxy-URLs, nie API-Pfade.

## Weiterleitungen alter URLs (308, `src/lib/redirects.ts`)
`/meute` → `/gruppen/sportliche-panther`, `/sippe/funkelfuechse`, `/sippe/die-goldenen-loewenzaehne` → `/gruppen/<gleicher Slug>`, `/sippe` → `/gruppen`,
`/download[/…]` → `/`. Ist der Ziel-Slug nicht auf der Website → `/gruppen` (bei API-Fehler trotzdem Ziel). Slugs im Gruppendialog → Reiter Website setzen.

## Pflege der Inhalte (Intern-Bereich)
Termine: „Auf der Website“ + Gruppen-Zuordnung. Galerien: Sichtbarkeit „öffentlich“ + Termine. Gruppen: Gruppendialog → Website (Checkbox, Adresse,
Text, Alter, Kontakt-E-Mail), Bild am Datensatz. Ämter: Ämterseite; Bio und Profilbild pflegt jede*r im Profil.

## Demo
```bash
npm run build && node scripts/demo-server.mjs   # :4300 (run_in_background), Daten wie in workflow.md seeden
node scripts/seed-demo-website.mjs              # Module, Gruppen „Sportliche Panther“/„Funkelfüchse“/„Die Goldenen Löwenzähne“
                                                # (fehlende werden angelegt, Texte der alten Website), Website-Termine/-Serien,
                                                # öffentliche Galerie (nur mit MinIO), API-Key „Stammeswebsite (Demo)“ neu → website/.env
cd website && npm run build && PORT=3001 node --env-file=.env build
```
- Das Seed-Skript wartet bei Login-Rate-Limit (429) und bricht bei fehlgeschlagenem Login ab; Slugs an fremden Gruppen werden freigegeben.
- Die Demo-DB `.data/pglite` kann ein geändertes Admin-Konto haben (dann `DEMO_EMAIL`/`DEMO_PASSWORD` setzen).

## Offen
- Datenschutztext muss fachlich/rechtlich überarbeitet werden (formsubmit.co, OSM-Kacheln, Ämter-Fotos/-Namen, Galerie-Fotos von Kindern,
  Verantwortlicher, veraltete Abschnitte Google Fonts/YouTube/Cookie-Banner).
- Formular-Adresse `kotakt@…` und Impressum-Adresse `info@edelweisspiaretn-bremen.de` aus der alten Seite vermutlich Tippfehler (unverändert übernommen).
- Karte zeigt immer die Kirche (`meetingPlace` nur als Text); Docker-Image der Website und echtes S3 (Galerie-/Gruppenbilder) ungeprüft.
- Einwilligungen (Fotos von Kindern) prüft das System nicht; Galerie-Freigabe „öffentlich“ bewusst setzen.
