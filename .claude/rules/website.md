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
  `npm run check` meldet **3 Fehler + Warnungen aus dem alten Code** (Leaflet-Typen, implizites `any` in Navbar/Startseite, a11y) – bekannt,
  nicht neu einführen. Es gibt kein `lint`/`test` in `website/`; reine Module (`event-pages.ts`, `backend-types.ts`) testet die Root-Suite
  (`tests/unit/website-event-pages.test.ts`, `website-contract.test.ts`).
- Der API-Key steht **nur** in `WEBSITE_API_KEY` (Server). Nie im Browser abfragen: Daten über `+page.server.ts` bzw. Server-Routen.
- Änderungen an den Website-DTOs im Backend (`WebsiteEvent`, `WebsiteGallery*`, `WebsiteGroup`) in `website/src/lib/server/backend-types.ts`
  nachziehen – `tests/unit/website-contract.test.ts` prüft Typgleichheit (`npm run check`), die `*-website`-Tests parsen gegen `website.schemas.ts`.

## Umgebung (`website/.env`, Vorlage `.env.example`)
| Variable | Bedeutung |
|---|---|
| `WEBSITE_API_URL` | Basis-URL des Intern-Bereichs, serverseitig (Standard `http://app:3000`, Demo `http://127.0.0.1:4300`) |
| `WEBSITE_API_KEY` | Key mit `events.website.read galleries.website.read members.website.read` |
| `ORIGIN` | öffentliche Adresse (adapter-node, CSRF) |
| `ADDRESS_HEADER`, `XFF_DEPTH` | hinter nginx `X-Forwarded-For` / `1` – sonst zählt das IP-Rate-Limit alle Besucher*innen als eine IP (Proxy) |
| `IMAGE_CACHE_MB`, `IMAGE_CACHE_TTL_SEC` | Bild-Cache im Arbeitsspeicher (Standard 48 MB, 3600 s; 0 = aus) |
| `CONTACT_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Kontaktformular (#31): Versand per SMTP an **eine feste** Adresse; ohne `SMTP_HOST`/`SMTP_FROM`/`CONTACT_TO` → Hinweis auf stafues@ (503) |

Compose (`docker-compose.yml`, `docker-compose.dokploy.yml`): Dienst `website` mit `WEBSITE_API_URL: http://app:3000`,
`WEBSITE_API_KEY: ${WEBSITE_API_KEY}`, `ORIGIN: ${WEBSITE_ORIGIN}`.

## Backend-Anbindung (`src/lib/server/backend.ts`)
- `getJson` (nur Pfade `/api/v1/modules/<x>/website/…`, Bearer-Key, Timeout 5 s) über `createCachedLoader` (`lib/server/cache.ts`, rein, #20):
  Erfolge 60 s, 404/422 60 s **negativ** gemerkt, gleichzeitige Abrufe **zusammengelegt**, bei Ausfall letzter Stand (neuer Versuch nach 5 s), ≤ 1000 Einträge.
  `fetchImage`/`fetchGroupImage` roh; gecacht wird im Bild-Proxy (`lib/server/images.ts` + `image-cache.ts`: LRU nach Bytes, 1 h, 404 60 s, ETag/304,
  nur `image/*` außer SVG, ≤ 15 MB).
- **IDs vorab prüfen**: Termin `EVENT_KEY_RE`, Galerie/Bild `UUID_RE`, Slug `SLUG_RE`; zusätzlich gegen die zwischengespeicherten Listen
  (`isListedEvent`, `isListedGallery`, `isKnownGalleryImage`, Gruppenliste) – unbekannte IDs erreichen das Backend nicht (ist die Liste gerade nicht
  abrufbar, wird direkt gefragt). Folge: `/termine/<id>` kennt nur Termine im Bereich der Terminseite (2023 bis Ende nächsten Jahres).
- **Seitenform** (2026-10-23, `src/lib/site-types.ts`, client-tauglich): `SiteEvent` (`key` = `<id>` bzw. bei Serien `<id>~<YYYY-MM-DD>`,
  Datum/Uhrzeit als `YYYY-MM-DD`/`HH:MM`, Ort, Farbe, `recurring`, `groups` mit Farbe + Gruppenseite, Themen-`tags`, verknüpfte `galleries`),
  `SiteGallery`/`SiteGalleryDetail` (Titelbild mit Maßen, Datum = frühester verknüpfter Termin, `events`, `groups` der Termine, Bilder mit
  `thumbUrl`/`webUrl`/Maßen/Beschreibung). Loader: `fetchEvents()` (2023 bis Ende nächsten Jahres, Halbjahres-Fenster parallel, je Fenster `paged=1`
  à 200, `event-pages.ts`), `fetchEvent(key)`, `fetchGalleries()`, `fetchGallery(id)`.
- Alte PocketBase-Form `Appointment` nur noch für `fetchUpcomingForGroup(slug)` (`/api/termine` → `AppointmentPreview` der Gruppenseite).
- Reine Hilfen (Root-Tests `website-event-view`, `website-month-calendar`): `lib/dates.ts` (Formate ohne Zeitzonenfallen, `todayBerlin`),
  `lib/event-view.ts` (Filter, Serien zusammenfassen inkl. Rhythmus aus den Abständen, Monate), `lib/month-calendar.ts` = **Kopie** von
  `src/lib/components/layout/month-calendar.ts` (Test hält beide gleich – Änderungen an beiden Stellen).

## Seiten und Routen
| Route | Quelle |
|---|---|
| `/` | FAQ fest in `src/lib/faqs.ts` (früher PocketBase `faqs`); Ferienhinweis statisch im Markup; Gruppenkarten aus dem Backend |
| `/termine` | `fetchEvents`; Ansichten **Kalender** (Standard, `MonthCalendar.svelte`, mobil Agenda) / **Kacheln** / **Liste** (nach Monaten), Wahl in `?ansicht=` + `localStorage`; Filter-Chips Gruppen/Themen + Suche (`?gruppe=&thema=&q=&monat=`, alte `?tags=` der Gruppenseite gelten weiter); Serien in Kacheln/Liste einmal als „Regelmäßige Termine“, Vergangene aufklappbar |
| `/termine/[id]` | `fetchEvent` (404 unbekannt, 503 Backend weg): Datum/Uhrzeit, Ort mit Link „In Karte öffnen“ (OSM-Suche, nur Link), Gruppen → Gruppenseite, verknüpfte Galerien, Teilen, OG-Tags |
| `/galerie`, `/galerie/[id]` | `fetchGalleries` / `fetchGallery`: Karten mit Titelbild (Maße, lazy), Bildanzahl, Gruppen; Filter Jahr/Gruppe/Suche (`?jahr=&gruppe=&q=`); Detail mit Bildern in Spalten (`thumb`, echte Seitenverhältnisse, Alt-Text = Bildbeschreibung), Lightbox (`web`, Unterschrift, Zähler, Tastatur/Wischen), Links zu den Terminen |
| `/meute/[slug]`, `/sippe/[slug]` | **aus dem Intern-Bereich** (`fetchGroup`, gemeinsamer Loader `lib/server/group-page.ts`, Vorlage `GroupPage.svelte` im Aufbau der alten Meute-Seite; Gruppenfarbe statt fester Farben). Falscher Typ → 308 auf `/<type>/<slug>`; `/meute` → 307 auf die erste Meute. `AppointmentPreview` (`gruppe` = Titel, `slug`) lädt per `fetch('/api/termine?gruppe=<slug>')` |
| Menü, Startseite („Unsere Gruppen“, `#gruppen`), Kontakt (Gruppen-Ansprechpartner) | `data.groups` aus `+layout.server.ts` (`fetchGroups`, ohne Backend leere Liste); Ämter auf `/kontakt` bleiben statisch |
| `/bilder/gruppe/[slug]` | Bild-Proxy fürs Gruppenbild (Cache je Slug + aktueller Version aus der Gruppenliste, `?v=` der Anfrage zählt nicht); ohne Bild im Backend nimmt `toGroup` das alte statische Bild je Slug |
| `/api/termine` | Server-Route: nächste 3 Termine der Gruppe (`fetchUpcomingForGroup`) |
| `/bilder/galerie/[id]/[imageId]/[variant]` | Bild-Proxy (`thumb`/`web`) mit Cache, `public, max-age=86400`, ETag |
| `/download[/…]` | **entfernt** (Nutzerentscheidung) → 308 auf `/` (`src/hooks.server.ts`), Menüpunkt gelöscht |
| `/kontakt` | Formular-Action `+page.server.ts` (#31, statt formsubmit.co): `parseContactForm`/`buildContactMessage` (`lib/server/contact.ts`), Versand mit eigenem SMTP-Client (`lib/server/smtp.ts`, nur `node:net`/`node:tls`, STARTTLS/465, AUTH nur mit TLS). Mail-Relay-Schutz: Empfänger/Absender/Betreff nur aus der Konfiguration, Eingaben nur im Base64-Text + `Reply-To` (geprüft), keine Auto-Antwort, Honeypot `website`, 5 / 10 min je IP + 30 / h gesamt, CSRF über `ORIGIN`. Erfolg → 303 `?success=1` |
| Karte (`Map.svelte`, Start + Kontakt) | **Zwei-Klick**: OSM-Kacheln erst nach „Karte laden“; vorher keine Anfrage an Dritte, Wahl nicht gespeichert |
| `/cpd`, `/impressum`, `/datenschutz` | statisch; Datenschutz (Stand 21.10.2026) nennt nur noch genutzte Dienste: eigener Server, Kontaktformular per SMTP, OSM nach Klick, Social-Media-Präsenzen (keine Google Fonts, kein Consent-Tool, keine YouTube-/Instagram-Einbettung) |
| alle dynamischen Anfragen | `hooks.server.ts`: Rate-Limit je IP (`/bilder/…` 600/min, sonst 240/min, 429 + `Retry-After`); statische Dateien zählen nicht |

Gruppen erscheinen, wenn sie im Intern-Bereich „auf der Website“ stehen (Gruppendialog → Reiter Website: Slug, Text, Alter, Kontakt-E-Mail;
Allgemein: Wochentag, Uhrzeit, Ende, Treffpunkt, Farbe; Leitung nur mit Vornamen). Für alte Links die Slugs `sportliche-panther`, `funkelfuechse`,
`die-goldenen-loewenzaehne` beibehalten. `prerender` ist aus (`+layout.js`), weil jede Seite die Gruppen zur Laufzeit lädt.

## Einwilligungen (#27, 2026-10-20)
- Leitende erscheinen nur mit Website-Einwilligung des Mitglieds (`consentWebsite`); ohne Einwilligung fehlen sie in `leaders` – leere Liste
  ist erlaubt (`joinNames([])` → `''`, `GroupPage.svelte` blendet „Ansprechpartner“ dann aus). Demo: Leitende brauchen `consentWebsite: true`.
- Ämter-API (`/website/offices`, noch **nicht** von der Website genutzt): nur Inhaber*innen mit eigenem Opt-in im Profil, sonst `holders: []`.
- Galerien sind erst nach dokumentierter Einwilligungs-Bestätigung öffentlich (`consentConfirmed`).

## Demo
```bash
npm run build && node scripts/demo-server.mjs   # :4300
node scripts/seed-demo-website.mjs              # Gruppen/Slugs, Termine, Galerie, API-Key → website/.env (WEBSITE_API_*)
cd website && npm run build && PORT=3001 node --env-file=.env build
```

## Offen
- Kontaktformular: echter SMTP-Versand ungetestet (nur Test-Server); Compose-Dateien reichen `SMTP_*`/`CONTACT_TO`/`ADDRESS_HEADER` noch nicht an den Dienst `website` durch;
  Empfängeradresse `kontakt@` (alt: Tippfehler „kotakt@“) vom Nutzer bestätigen lassen. Datenschutztext rechtlich nicht geprüft.
- Caches und Rate-Limits nur im Arbeitsspeicher je Prozess (Neustart leert sie).
- Datenschutztext, Ferienhinweis (statisch, Termine darin veraltet) und FAQ-Texte pflegen sich nur im Code.
- Serien-Rhythmus wird aus den Abständen der Vorkommen geraten (das Backend liefert die Regel nicht); ungewöhnliche Rhythmen → „regelmäßig“.
- `/termine` lädt alle Vorkommen 2023 bis Ende nächsten Jahres auf einmal (bei vielen Serien wächst die Seite).
- Altes `ecosystem.config.cjs` (PM2) unverändert übernommen, ungeprüft.
