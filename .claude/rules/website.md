---
paths: ["website/**", "scripts/seed-demo-website.mjs", "src/lib/modules/*/website.endpoints.ts", "tests/**/*website*"]
---

# Stammeswebsite (`website/`)

**Stand 2026-10-19 (Nutzerentscheidung):** `website/` ist die **alte Website** aus
`https://github.com/CrayonGamerHD-Philipp/edelweisspiraten-website` (Ordner `web/`, Stand `ba0b441`), bei der **nur das Backend
getauscht** ist: statt PocketBase holt sie Termine und Galerien **serverseitig** aus den Website-Endpunkten des Intern-Bereichs.
(Die zwischenzeitlich neu gebaute Website mit Figuren/Motiven wurde verworfen; sie steht noch in der Git-Historie.)
**Redesign 2026-10-25 (Nutzerauftrag, Konzept-Artifact „Stammeswebsite – Redesign-Konzept“ inkl. Unterseiten):** löst das Design vom 24.10.
(Indigo, Linien, eine Textspalte) ab. Inhalte, Daten und Routen bleiben.

## Gestaltung und Dunkelmodus
- **Stil**: weißer Grund, „Wolke“ `#f5f5f5` (`bg-subtle`, Hover `bg-subtle-2`) für Flächen/Karten/Felder, Tinte `#111` (`text-ink`, Hauptknopf, Fuß).
  Farbe kommt nur aus Fotos, Wappen und kleinen Gruppen-Punkten (`.dot` mit `--g`). Knöpfe immer als Pille, Bilder/Flächen eckig, **keine Schatten,
  keine Rahmen**. Breite `site-container` = 90rem mit Rand `clamp(16px, 3.3vw, 48px)`, Abschnittsabstand `section-gap`, Raster meist 12 Spalten,
  Umbruch auf eine Spalte bei `max-width: 50rem`.
- **Schrift** selbst gehostet (`@fontsource/bebas-neue` 5.3.0, `@fontsource-variable/inter` 5.3.0, Import in `app.css`) – keine Anfrage an Google
  (Datenschutz). Bebas Neue (`.display`) nur für große Bildüberschriften/Seitentitel, sonst Inter 15–32 px (`.h-xl` Abschnitt, `.cap` Nebeninfo).
- **Bausteine in `app.css`** (global): `.pill` (+ `soft|canvas|white|glass|dim|sm`), `.round`, `.ulink`/`.text-link`, `.ic` (Symbolkreis), `.rowhead`,
  `.crumbs`, `.phead` (Titel links, Einleitung rechts), `.tag`, `.chips`/`.chip` (`aria-pressed`/`aria-current` = aktiv, `.chips.scroll` mobil
  waagerecht scrollbar), `.seg` (Umschalter), `.facts`/`.fact`, `.tlist`/`.tl`/`.dbox` (Terminzeile mit Datumsblock), `.tile`, `.grid3|grid4`,
  `.empty`, `.abox`, `.field`/`.label`/`.field-error`, `.camp` (Foto mit Schrift), `.mapbox`, `.richtext`, `.legal-doc`/`.legal-title`.
  Symbole: `Icon.svelte` (Lucide-Pfade als feste Zeichenketten, Klasse `i`, viele Namen). `Chip.svelte`/`StammHeader.svelte` entfernt.
- **Layout**: Hinweisleiste (`SiteBanner`, Wolke bzw. Tinte bei „wichtig“), Navigation (Wappen + Name | Gruppen▾, Termine, Galerie, Blog, Über uns▾
  (Team, CPD, FAQ, Kontakt) | Dunkel-Umschalter, Kontakt, „Probestunde“; mobil Menü-Fläche), Fuß mit „Komm zur Probestunde“, Kacheln
  (Marke/Social, Gruppen mit Zeit, Stamm-Links, Anfahrt) und Rechtliches.
- **Startseite**: Hero mit `pfadfinder.avif` (Kornfeld), `home`-Banner als Kästen, Kurzinfo + Eckdaten (Alter, Tage aus den Gruppen, Ort, 47 €),
  Gruppen-Leiste (Pfeile ab 4 Gruppen), zweite Foto-Kachel „Fahrten und Lager“ mit dem Titelbild (`web`) der neuesten Galerie (ohne Galerie entfällt sie),
  Nächste Termine, „Zuletzt unterwegs“ (Galerien + Beiträge gemischt), Über uns, FAQ (`featured`), Kontaktformular → Action von `/kontakt`.
- Unterseiten: Seitenkopf `.phead` mit Brotkrümeln; Gruppe (Bild, Eckdaten, Text, Termine, Bilder der Gruppe, Kontakt + Karte, weitere Gruppen – Loader
  liefert jetzt `events` **und** `galleries`; vorher fehlten die Termine auf der Gruppenseite), Termine (Suche, Chips, Kalender/Kacheln/Liste, Seitenspalte
  „Regelmäßige Termine“; Kalenderbalken nur mit Titel), Termin (Infokasten, Bilder, weitere Termine – Loader `more`), Galerie (Aufmacher + Raster),
  Album (Spalten, Lightbox, weitere Alben – Loader `more`), Blog (Aufmacher auf Seite 1 + Raster), Beitrag (Seitenspalte „Dazu passend“), Team, FAQ
  (Suche ab 5 Fragen, „Auf einen Blick“), Kontakt (Formular, Ansprechpartner*innen, Karte), CPD (Aufbau Bund → Gruppen, Epochen-Akkordeon),
  Impressum/Datenschutz (Texte unverändert), Fehlerseite.
- Gruppenzeit jetzt „16:30–18:00 Uhr“ (`toGroup`); Startzeit über `time.split(/[–\s]/)[0]`.
- Dunkelmodus = `html.dark` (Tokens in `app.css` umgeschaltet: Grund `#0e0e0f`, Wolke `#1b1b1d`, Tinte `#f3f3f3`). Cookie `theme` (`light|dark`, 1 Jahr,
  nur bei ausdrücklicher Wahl über `ThemeToggle.svelte`) → `hooks.server.ts` setzt die Klasse (`%ep.theme%`); ohne Cookie Inline-Skript nach
  `prefers-color-scheme`. Umgedrehte Grauskala bleibt als Rückfall für übersehene `gray`-Klassen.
- Bausteine: `EventList.svelte` (`.tl`-Zeilen; `null` = Ladefehler-Hinweis), `EmailButtons` (Prop `onCloud`), `Map` (Prop `height` in px, Zwei-Klick),
  `FaqList` (Prop `openFirst`), `MonthCalendar` (Wolke-Zellen, Agenda unter 40rem).

## Grundregeln
- Eigenes Projekt (`package.json` „web“, SvelteKit 2 / Svelte 5 im **Legacy-Modus** mit `export let`, Tailwind 4, `adapter-node`, Port 3001,
  `Dockerfile`, `.dockerignore`). Root-Werkzeuge ignorieren `website/`. Die Website importiert **nichts** aus `src/`.
- Befehle im Ordner `website/`: `npm run dev` / `npm run check` / `npm run build`, Start `WEBSITE_API_KEY=… PORT=3001 node build`.
  `npm run check` meldet **1 Fehler + Warnungen aus dem alten Code** (Leaflet-Typen; a11y in `Share.svelte`) – bekannt,
  nicht neu einführen. Es gibt kein `lint`/`test` in `website/`; reine Module (`event-pages.ts`, `backend-types.ts`) testet die Root-Suite
  (`tests/unit/website-event-pages.test.ts`, `website-contract.test.ts`).
- Der API-Key steht **nur** in `WEBSITE_API_KEY` (Server). Nie im Browser abfragen: Daten über `+page.server.ts` bzw. Server-Routen.
- Änderungen an den Website-DTOs im Backend (`WebsiteEvent`, `WebsiteGallery*`, `WebsiteGroup`) in `website/src/lib/server/backend-types.ts`
  nachziehen – `tests/unit/website-contract.test.ts` prüft Typgleichheit (`npm run check`), die `*-website`-Tests parsen gegen `website.schemas.ts`.

## Umgebung (`website/.env`, Vorlage `.env.example`)
| Variable | Bedeutung |
|---|---|
| `WEBSITE_API_URL` | Basis-URL des Intern-Bereichs, serverseitig (Standard `http://app:3000`, Demo `http://127.0.0.1:4300`) |
| `WEBSITE_API_KEY` | Key mit `events.website.read galleries.website.read members.website.read offices.website.read website.content.read messages.website.contact` |
| `ORIGIN` | öffentliche Adresse (adapter-node, CSRF) |
| `ADDRESS_HEADER`, `XFF_DEPTH` | hinter nginx `X-Forwarded-For` / `1` – sonst zählt das IP-Rate-Limit alle Besucher*innen als eine IP (Proxy) |
| `IMAGE_CACHE_MB`, `IMAGE_CACHE_TTL_SEC` | Bild-Cache im Arbeitsspeicher (Standard 48 MB, 3600 s; 0 = aus) |
| `CONTACT_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Kontaktformular: **nur Rückfall** bei Ausfall des Backends (#31, SMTP an **eine feste** Adresse); ohne → Hinweis auf stafues@ (503) |

Compose (`docker-compose.yml`, `docker-compose.dokploy.yml`): Dienst `website` mit `WEBSITE_API_KEY: ${WEBSITE_API_KEY}`,
`ORIGIN: ${WEBSITE_ORIGIN}`; `WEBSITE_API_URL` = `http://app:3000` (docker-compose.yml) bzw. `http://ep-intern-${DEPLOY_ENV:-prod}-app:3000`
(Dokploy). **Dokploy (2026-10-25):** `app`/`website` hängen im gemeinsamen `dokploy-network`, wo `app`/`db`/`storage` eines zweiten Stacks
(Staging) reihum mit auflösten → sporadische 401 „API-Key wird nicht akzeptiert“ → 503. Daher `DEPLOY_ENV` je Stack und Aliase
`ep-intern-<env>-app|db|storage` im stackeigenen `internal`; neue Verbindungen zwischen Diensten nur über diese Aliase.

## Backend-Anbindung (`src/lib/server/backend.ts`)
- `getJson` (nur Pfade `/api/v1/modules/<x>/website/…`, Bearer-Key) über `createCachedLoader` (`lib/server/cache.ts`, rein, #20):
  Erfolge 60 s, 404/422 60 s **negativ** gemerkt, gleichzeitige Abrufe **zusammengelegt**, bei Ausfall letzter Stand (neuer Versuch nach 2 s), ≤ 1000 Einträge.
- **Wiederholung** (2026-10-24, `lib/server/retry.ts`, Test `website-retry`): jede Backend-Anfrage (auch Bilder) bis zu 3 Versuche, 4 s Timeout je Versuch,
  Pausen 300/1000 ms, bei Netzwerkfehler (z. B. geschlossene Keep-alive-Verbindung „other side closed“), Timeout und 408/429/502/503/504 (`Retry-After` ≤ 2 s).
  Jeder Fehlversuch und jeder endgültige Fehler steht im Log (`[backend] <Pfad ohne Query>: …`). Ursache der früheren sporadischen 503: einzelne Aussetzer
  (Neustart beim Autodeploy, Keep-alive) wurden ohne Wiederholung sofort zur Fehlerseite und 5 s gemerkt.
- **Fehlerseite** `routes/+error.svelte`: 404 mit Links; 502/503/504 „Gerade nicht erreichbar“ mit automatischem Neuladen (`invalidateAll`) nach 5/10/20 s und Knopf „Jetzt erneut versuchen“, `noindex`.
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
- **Nächste Termine** (Startseite, Gruppenseite): `fetchUpcomingEvents({ limit, groupSlug? })` – ein kleiner Abruf `from=heute`, `to=+180 Tage`,
  `limit=100` (ohne `paged`), **ohne Serien** (Gruppenstunden stehen bei den Gruppen), serverseitig im Loader mit `.catch(() => null)`:
  ohne Backend bleibt die Seite erreichbar und zeigt einen Hinweis. Die Gruppenseite selbst braucht weiter die Gruppe (sonst 503-Fehlerseite).
- Reine Hilfen (Root-Tests `website-event-view`, `website-month-calendar`): `lib/dates.ts` (Formate ohne Zeitzonenfallen, `todayBerlin`),
  `lib/event-view.ts` (Filter, Serien zusammenfassen inkl. Rhythmus aus den Abständen, Monate), `lib/month-calendar.ts` = **Kopie** von
  `src/lib/components/layout/month-calendar.ts` (Test hält beide gleich – Änderungen an beiden Stellen).

## Seiten und Routen
| Route | Quelle |
|---|---|
| `/` | Hero, Hinweiskästen (`home`-Banner aus dem Modul `website`), Gruppen als Liste (Bild, Alter, Zeit, Teaser), Nächste Termine (`fetchUpcomingEvents`), Aktuelles (3 neueste Beiträge), Über uns, FAQ (`featured` aus dem Backend, Rückfall `src/lib/faqs.ts`) + Karte |
| alle Seiten | Banner-Leiste (`bar`) über der Navigation (`SiteBanner.svelte`, schließbar → `localStorage` `ep:hinweise-geschlossen`), RSS-`<link rel="alternate">` |
| `/blog`, `/blog/[slug]`, `/blog/rss.xml` | Modul `website`: Liste (Themen-Chips `?thema=`, Seiten `?seite=`, 12 je Seite), Beitrag (Titelbild, Text über `lib/server/rich-text.ts` `renderRichText` – zweite Bereinigung + Bilder auf den Proxy, Themen, Verknüpfungen nur wenn öffentlich gelistet, Teilen, OG), RSS 2.0 (20 neueste, 10 min Cache) |
| `/faq` | alle aktiven Fragen (`FaqList.svelte`, Akkordeon mit IDs), Rückfall `lib/faqs.ts` bei Ausfall |
| `/bilder/blog/[slug]/[imageId]/[variant]` | Bild-Proxy (`blogImage`, nur Bilder veröffentlichter Beiträge) |
| `/termine` | `fetchEvents`; Ansichten **Kalender** (Standard, `MonthCalendar.svelte`, mobil Agenda) / **Kacheln** / **Liste** (nach Monaten), Wahl in `?ansicht=` + `localStorage`; Filter-Chips Gruppen/Themen + Suche (`?gruppe=&thema=&q=&monat=`, alte `?tags=` der Gruppenseite gelten weiter); Serien in Kacheln/Liste einmal als „Regelmäßige Termine“, Vergangene aufklappbar |
| `/termine/[id]` | `fetchEvent` (404 unbekannt, 503 Backend weg): Datum/Uhrzeit, Ort mit Link „In Karte öffnen“ (OSM-Suche, nur Link), Gruppen → Gruppenseite, verknüpfte Galerien, Teilen, OG-Tags |
| `/galerie`, `/galerie/[id]` | `fetchGalleries` / `fetchGallery`: Karten mit Titelbild (Maße, lazy), Bildanzahl, Gruppen; Filter Jahr/Gruppe/Suche (`?jahr=&gruppe=&q=`); Detail mit Bildern in Spalten (`thumb`, echte Seitenverhältnisse, Alt-Text = Bildbeschreibung), Lightbox (`web`, Unterschrift, Zähler, Tastatur/Wischen), Links zu den Terminen |
| `/meute/[slug]`, `/sippe/[slug]` | **aus dem Intern-Bereich** (`fetchGroup`, gemeinsamer Loader `lib/server/group-page.ts`, Vorlage `GroupPage.svelte`: Kopf mit Bild/Name, Eckdaten, Text, nächste Termine der Gruppe serverseitig, Kontakt, Karte). Falscher Typ → 308 auf `/<type>/<slug>`; `/meute` → 307 auf die erste Meute |
| Menü, Startseite („Unsere Gruppen“, `#gruppen`), Kontakt (Gruppen-Ansprechpartner) | `data.groups` aus `+layout.server.ts` (`fetchGroups`, ohne Backend leere Liste); Ämter auf `/kontakt` bleiben statisch |
| `/bilder/gruppe/[slug]` | Bild-Proxy fürs Gruppenbild (Cache je Slug + aktueller Version aus der Gruppenliste, `?v=` der Anfrage zählt nicht); ohne Bild im Backend nimmt `toGroup` das alte statische Bild je Slug |
| `/team` | „Unser Team“ (2026-10-24, Menüpunkt vor Kontakt): `fetchTeam` = Ämter in Reihenfolge des Intern-Bereichs (ohne Personen **und** ohne Adresse weggelassen), je Amt Beschreibung, Inhaber*innen (**nur Vorname**, Profilbild oder Initiale, „seit <Jahr>“, Bio mit „Mehr lesen“), Amts-Adressen mit `EmailButtons` |
| `/bilder/team/[userId]` | Bild-Proxy für Profilbilder (`teamImage`, Cache je Person + `?v=` aus `avatarPath`); nur Personen, die mit Bild in der Ämterliste stehen, sonst 404 ohne Backend-Abruf |
| `/bilder/galerie/[id]/[imageId]/[variant]` | Bild-Proxy (`thumb`/`web`) mit Cache, `public, max-age=86400`, ETag |
| `/download[/…]` | **entfernt** (Nutzerentscheidung) → 308 auf `/` (`src/hooks.server.ts`), Menüpunkt gelöscht |
| `/kontakt` | **Seit 2026-10-25 in den Posteingang des Intern-Bereichs** (Stamm-Postfach, `submitContact` in `backend.ts` → `messages` `POST /website/contact`, Scope `messages.website.contact`, Wiederholung bei Aussetzern unbedenklich, 409 = schon angekommen). Spam-Schutz zusätzlich: `ContactGuard.svelte` (in beiden Formularen, Start und `/kontakt`) holt per `GET /kontakt/challenge` (Server-Route, `no-store`, 30/10 min je IP) eine Proof-of-Work-Aufgabe, löst sie mit `lib/pow.ts` (WebCrypto, braucht HTTPS/localhost) und legt die Lösung in das Feld `pow` (`parsePow`); wer vorher absendet, wartet, das Formular geht danach selbst ab; ohne JavaScript Hinweis + Adresse. 422 vom Backend (zu schnell < 3 s, abgelaufen > 2 h, ungültig) → Text im Formular. Backend weg/falsch eingerichtet → **Rückfall SMTP** (falls konfiguriert): `parseContactForm`/`buildContactMessage` (`lib/server/contact.ts`), Versand mit eigenem SMTP-Client (`lib/server/smtp.ts`, nur `node:net`/`node:tls`, STARTTLS/465, AUTH nur mit TLS). Mail-Relay-Schutz: Empfänger/Absender/Betreff nur aus der Konfiguration, Eingaben nur im Base64-Text + `Reply-To` (geprüft), keine Auto-Antwort, Honeypot `website`, 5 / 10 min je IP + 30 / h gesamt, CSRF über `ORIGIN`. Erfolg → 303 `?success=1` |
| Karte (`Map.svelte`, Start + Kontakt) | **Zwei-Klick**: OSM-Kacheln erst nach „Karte laden“; vorher keine Anfrage an Dritte, Wahl nicht gespeichert |
| `/cpd`, `/impressum`, `/datenschutz` | statisch; Datenschutz (Stand 21.10.2026) nennt nur noch genutzte Dienste: eigener Server, Kontaktformular per SMTP, OSM nach Klick, Social-Media-Präsenzen (keine Google Fonts, kein Consent-Tool, keine YouTube-/Instagram-Einbettung) |
| alle dynamischen Anfragen | `hooks.server.ts`: Rate-Limit je IP (`/bilder/…` 600/min, sonst 240/min, 429 + `Retry-After`); statische Dateien zählen nicht |

Gruppen erscheinen, wenn sie im Intern-Bereich „auf der Website“ stehen (Gruppendialog → Reiter Website: Slug, Text, Alter, Kontakt-E-Mail;
Allgemein: Wochentag, Uhrzeit, Ende, Treffpunkt, Farbe; Leitung nur mit Vornamen). Für alte Links die Slugs `sportliche-panther`, `funkelfuechse`,
`die-goldenen-loewenzaehne` beibehalten. `prerender` ist aus (`+layout.js`), weil jede Seite die Gruppen zur Laufzeit lädt.

## Einwilligungen (#27, 2026-10-20)
- Leitende erscheinen nur mit Website-Einwilligung des Mitglieds (`consentWebsite`); ohne Einwilligung fehlen sie in `leaders` – leere Liste
  ist erlaubt (`joinNames([])` → `''`, `GroupPage.svelte` blendet „Ansprechpartner“ dann aus). Demo: Leitende brauchen `consentWebsite: true`.
- Ämter-API (`/website/offices`, Seite „Unser Team“): nur Inhaber*innen mit eigenem Opt-in im Profil, sonst `holders: []`; **nur Vornamen**
  (`firstName` = erstes Wort des Kontonamens, Nutzerwunsch 2026-10-24) – der Nachname verlässt den Intern-Server nicht.
- Galerien sind erst nach dokumentierter Einwilligungs-Bestätigung öffentlich (`consentConfirmed`).

## Demo
```bash
npm run build && node scripts/demo-server.mjs   # :4300
node scripts/seed-demo-website.mjs              # Gruppen/Slugs, Termine, Galerie, API-Key → website/.env (WEBSITE_API_*)
cd website && npm run build && PORT=3001 node --env-file=.env build
```

## Offen
- Kontaktformular: Anfragen per Posteingang nur mit Demo/Integrationstest geprüft; bestehender Produktiv-Key braucht den neuen Scope (neuen Key anlegen);
  SMTP-Rückfall: echter Versand ungetestet (nur Test-Server); Compose-Dateien reichen `SMTP_*`/`CONTACT_TO`/`ADDRESS_HEADER` noch nicht an den Dienst `website` durch;
  Empfängeradresse `kontakt@` (alt: Tippfehler „kotakt@“) vom Nutzer bestätigen lassen. Datenschutztext rechtlich nicht geprüft.
- Caches und Rate-Limits nur im Arbeitsspeicher je Prozess (Neustart leert sie).
- Datenschutztext pflegt sich nur im Code (Ferienhinweis und FAQ seit 2026-10-25 über das Modul `website`).
- Serien-Rhythmus wird aus den Abständen der Vorkommen geraten (das Backend liefert die Regel nicht); ungewöhnliche Rhythmen → „regelmäßig“.
- `/termine` lädt alle Vorkommen 2023 bis Ende nächsten Jahres auf einmal (bei vielen Serien wächst die Seite).
- Altes `ecosystem.config.cjs` (PM2) unverändert übernommen, ungeprüft.
