# Machbarkeitsstudie: ArtCraft-Office in der Stammeswebsite

**Stand:** 25. Oktober 2026  
**Scope:** WordCraft (Text), GridCraft (Tabellen), DeckCraft (Präsentationen); Integration in `website/` und gleichzeitige Bearbeitung durch mehrere angemeldete Personen.

## Ergebnis

**Fork und Einbettung sind technisch und lizenzrechtlich grundsätzlich machbar.** Die Repositories sind unter MIT oder Apache-2.0 lizenziert. Lizenz- und Drittanbieterhinweise müssen erhalten bleiben; ArtCraft-Marken und Logos müssen bei einem Fork entfernt werden.

**Das gewünschte Gesamtprodukt ist mit dem Stand der Upstream-Projekte nicht direkt verfügbar.** Es gibt WebAssembly-Builds für statisches Hosting, aber keine belegte serverseitige Dokumentablage, Benutzerverwaltung oder Echtzeit-Kollaboration. Die Web-Editoren sind eigenständige Anwendungen. Der Upstream bezeichnet WordCraft, GridCraft und DeckCraft als Alpha und weist selbst noch erhebliche Arbeit bis zur Beta aus.

**Empfehlung:** Erst einen begrenzten WordCraft-Prototyp für eingeloggte Nutzer*innen im internen Bereich bauen, zunächst mit serverseitigem Speichern, Versionierung und exklusiver Bearbeitungssperre. Echte gleichzeitige Bearbeitung ist ein separates, großes Entwicklungsprojekt und sollte erst nach einem technischen Spike beschlossen werden. Für simultanes Bearbeiten als zwingende Startanforderung ist ein vorhandener Office-Server mit Kollaborationsprotokoll voraussichtlich der risikoärmere Weg.

## Was ArtCraft mitbringt

| Editor | Web-Ausgabe und Reifegrad laut Upstream | Lizenz |
|---|---|---|
| WordCraft | Rust-Anwendung mit WebAssembly-Build; Alpha, Upstream-Schätzung: etwa 60 % „ready for real work“, 150–230 Stunden bis zur Beta | MIT oder Apache-2.0 |
| GridCraft | WebAssembly-Build als statische Website; Alpha, etwa 50 % „ready for real work“, 160–240 Stunden bis zur Beta | MIT oder Apache-2.0 |
| DeckCraft | Browser-Build; Alpha, etwa 55 % „ready for real work“, 120–210 Stunden bis zur Beta | MIT oder Apache-2.0 |

Die Prozent- und Stundenangaben sind Selbsteinschätzungen der jeweiligen Upstream-Roadmaps, keine unabhängige Qualitätsmessung und keine Aufwandsschätzung für dieses Repo. WordCraft unterstützt laut README DOCX lesen/schreiben und weitere Import-/Exportformate; GridCraft arbeitet mit XLSX und listet noch Lücken bei Dateitreue und großen Arbeitsmappen. Vor einem produktiven Einsatz wären repräsentative Dateien aus dem Stamm gegen Word/Excel/PowerPoint zu testen.

Die Anwendungen sind in Rust aufgebaut und nutzen für die Oberfläche `egui`; die Webversion ist jeweils ein eigenständiger WASM-Client. Das ist nicht dasselbe wie eine Svelte-Komponente. Eine Integration wäre am ehesten ein eigenständiger Editor unter einem eigenen Pfad, eingebunden als App/iframe oder als stark angepasster WASM-Client.

## Bezug zum aktuellen Repo

- Die Stammeswebsite in `website/` ist eine öffentliche SvelteKit-Anwendung. In ihrer Abhängigkeiten und Routenstruktur ist keine Benutzeranmeldung und kein gemeinsamer Dokument-Editor vorhanden.
- `WEBSITE_API_KEY` wird serverseitig für öffentliche Website-Daten verwendet. Dieser Schlüssel ist keine Identität einer bearbeitenden Person und darf nicht als Dokumentzugriff für Browser-Clients verwendet werden.
- Der interne Hauptbereich hat bereits Authentifizierung, Rollen/Berechtigungen und das Modul `files` mit S3-kompatiblem Speicher. Das ist eine deutlich passendere Basis für private Dokumente als die öffentliche Website.
- Die öffentliche Website ist im Compose-Setup auf 256 MB RAM und 0,5 CPU begrenzt. Ein WASM-Editor kann zusätzlich erheblichen Speicher im Browser beanspruchen; Serverlimits und Browser-Performance sind getrennt zu messen.
- Der Backend-API-Key und ein einzelner „Speichern“-Endpunkt lösen keine gemeinsame Bearbeitung. Für jeden Schreib- und Abrufvorgang muss die angemeldete Person serverseitig geprüft werden.

**Folgerung:** Der nutzbare Einstieg sollte im authentifizierten Intern-Bereich liegen, auch wenn die Website als Einstiegspunkt oder Navigation dient. Eine Veröffentlichung unter einer öffentlichen URL ohne Authentifizierung wäre für interne Dokumente ungeeignet.

## Was für einen brauchbaren Einzel-Editor nötig wäre

1. Upstream-Version festlegen und reproduzierbaren WASM-Build erzeugen; keine direkte Abhängigkeit auf `main`.
2. Einen Editor in einem isolierten Pfad ausliefern und dessen Weboberfläche an die Anwendung anbinden. Datei öffnen und speichern müssen über eine klar definierte Schnittstelle statt nur über lokale Browser-Dateidialoge funktionieren.
3. Authentifizierte Endpunkte im Backend ergänzen: Dokumentliste, Download, Upload/Save-As, Metadaten und Versionen. Berechtigungen pro Dokument bzw. Ordner aus dem vorhandenen Dateien-/Freigabemodell anwenden.
4. Autosave mit Versionsnummer/ETag und Konfliktantwort implementieren. Eine veraltete Version darf nicht stillschweigend eine neuere Fassung überschreiben.
5. Änderungsverlauf, Wiederherstellung, Dateigrößenlimits, Upload-Validierung und geeignete Backups ergänzen.
6. CSP, Reverse-Proxy-Pfade, WASM-MIME-Typen, Cache-Header, Speicherbedarf und Verhalten auf Mobilgeräten prüfen.

Das wäre eine verwertbare erste Ausbaustufe: Dokumente zentral ablegen, öffnen, bearbeiten und versioniert speichern. Eine Bearbeitungssperre verhindert zunächst gleichzeitige Schreibvorgänge; sie ist keine Echtzeit-Kollaboration.

## Was echte gleichzeitige Bearbeitung zusätzlich erfordert

Ein gemeinsames Dokument braucht mehr als WebSockets oder einen Yjs-Server. Die Änderungen müssen in der internen Dokumentstruktur des jeweiligen Editors kollisionsfest zusammengeführt werden. Zusätzlich sind erforderlich:

- gemeinsames Änderungsprotokoll, Reihenfolge und Wiederverbindung nach Netzunterbrechung;
- Synchronisierung von Cursor/Selektion und sichtbaren Mitbearbeitenden;
- Undo/Redo pro Person trotz eingehender Änderungen anderer;
- Konfliktregeln für strukturelle Aktionen wie Seiten-/Abschnittsumbrüche, Tabellenzeilen, Zellbereiche, Folien und Arbeitsblätter;
- dauerhafte Änderungslogs, Snapshots, Wiederherstellung und Schema-Versionierung;
- rollenbasierte Schreib-/Leserechte, Sperren, Audit und Datenschutz;
- Tests mit mehreren echten Browser-Sitzungen und echten PostgreSQL-Verbindungen.

Die Editor-Repositories dokumentieren die Browserausgabe, aber in den geprüften READMEs und Roadmaps kein fertiges Mehrbenutzer- oder Server-Synchronisationssystem. Eine generische CRDT-Schicht lässt sich nicht einfach außen an den UI-Canvas hängen; sie muss mit dem jeweiligen Dokumentmodell und dessen Befehls-/Undo-System zusammenspielen. Für WordCraft, GridCraft und DeckCraft wäre das jeweils separat zu untersuchen.

## Grobe Aufwandsspanne

Nur Orientierung für eine Person mit Rust, WebAssembly und SvelteKit-Erfahrung; Unsicherheit hoch, Upstream-Reife und Umfang der Nutzung wirken stark auf den Aufwand.

| Stufe | Inhalt | Grobe Größenordnung |
|---|---|---:|
| Technischer Spike | WordCraft im geschützten Bereich laden; Demo-DOCX öffnen/exportieren; WASM, Assets, CSP und Browser-Speicher messen | 3–5 Personentage |
| Einzelbearbeitung, WordCraft | Authentifizierung, Dateien-API, Versionen, Konfliktschutz, Recovery, UI und Betriebsintegration | 4–8 Personenwochen zusätzlich zum Spike |
| Echte Kollaboration, ein Editor | Modell-/Befehls-Sync, Persistenz, Präsenz, Wiederverbindung, Undo/Redo, Rechte und Multi-Client-Tests | eher mehrere Personenmonate; zuerst Spike/Prototyp erforderlich |
| GridCraft/DeckCraft | weitere Editorintegration; Kollaborationsmodell erneut je App bewerten | zusätzlicher Aufwand je Editor, nicht nur ein UI-Schalter |

Diese Werte sind eine interne grobe Einschätzung, keine Zusage. Der Upstream-Aufwand bis Beta kommt gegebenenfalls hinzu, wenn die benötigten Dateifunktionen/Fidelity im Alltag noch nicht genügen.

## Vorgehensvorschlag

### Phase 1: Entscheidungs-Spike

- Nur WordCraft; zunächst keine Tabellen und Präsentationen.
- Im authentifizierten Intern-Bereich statt in der öffentlichen Website.
- Einen DOCX aus dem bestehenden Dateispeicher laden, im Browser bearbeiten und als neue Version speichern.
- Zwei Sessions öffnen lassen und dabei zunächst eine klare Sperre bzw. einen Versionskonflikt erzwingen.
- CPU/RAM, Ladezeit, Browserunterstützung, DOCX-Roundtrip, Uploadgrößen und Mobile-Verhalten messen.
- Ergebnis mit echten, unkritischen Beispieldokumenten prüfen; keine personenbezogenen Mitgliederdaten verwenden.

### Phase 2: Einzelbearbeitung produktionsfähig machen

Nach positivem Spike: Berechtigungsmodell, Versionierung, Wiederherstellung, Upload-Schutz, Audit und Betriebs-/Backup-Konzept implementieren. Gleichzeitiges Öffnen darf bis dahin entweder nur lesend erfolgen oder muss eine klare Sperre anzeigen.

### Phase 3: Kollaboration separat entscheiden

Mit dem Upstream klären, ob ein unterstütztes Sync-/Plugin-API oder eine serverseitige Integrationsschicht geplant ist. Einen Prototyp für einen Dokumenttyp bauen und Konfliktfälle messen. Erst danach entscheiden, ob das Modell für weitere Editors wiederverwendbar ist.

## Alternativen

- **ONLYOFFICE Docs**: bestehender Office-Server mit Echtzeit-Kollaboration für DOCX/XLSX/PPTX und dokumentiertem Integrationsweg. Community Edition steht unter AGPL-3.0; bei einer Netzwerkbereitstellung sind die Lizenzfolgen für abgeleitete Werke zu prüfen. Der Upstream empfiehlt die Community Edition für bis zu 20 Nutzer*innen. Das reduziert Editor-Eigenentwicklung, bringt aber einen zusätzlichen Server, Ressourcenbedarf und Lizenzprüfung.
- **Collabora Online**: ebenfalls eine vorhandene browserbasierte Office-Server-Integration; vor einer Auswahl sind unterstützte Dateiformate, Bedienung, Betriebsaufwand und Lizenz/Edition für den konkreten Einsatz zu vergleichen.
- **ArtCraft**: bessere Wahl, wenn der Fokus auf quelloffenen, selbst gehosteten Einzel-Editoren und möglicher Mitentwicklung liegt. Für simultane Bearbeitung aktuell kein fertiger Ersatz für eine etablierte Office-Kollaborationsplattform.

## Risiken und offene Entscheidungen

- Welche Dokumente sollen bearbeitet werden: nur neue interne Dokumente oder auch Mitgliederdokumente mit sensiblen Daten?
- Wie viele Personen sollen gleichzeitig bearbeiten und welche Nutzerzahl ist realistisch?
- Muss Echtzeit-Kollaboration ab dem ersten Release vorhanden sein, oder genügt zunächst zentrale Ablage mit Versionsschutz?
- Welches Format ist maßgeblich: DOCX/XLSX/PPTX oder ein natives ArtCraft-Format?
- Akzeptiert der Betrieb einen zusätzlichen Office-Server, oder muss alles in die bestehende App integriert sein?
- Die Upstream-Repositories entwickeln sich sehr schnell und sind Alpha. Releases pinnen, Security-/Lizenzänderungen beobachten und Updates testen.

## Quellen

- [WordCraft README](https://github.com/storytold/wordcraft) · [WordCraft Roadmap](https://github.com/storytold/wordcraft/blob/main/ROADMAP.md) · [WordCraft-Web-Build und Lizenz](https://github.com/storytold/wordcraft/blob/main/README.md)
- [GridCraft README](https://github.com/storytold/gridcraft) · [GridCraft Roadmap](https://github.com/storytold/gridcraft/blob/main/ROADMAP.md)
- [DeckCraft README](https://github.com/storytold/deckcraft) · [DeckCraft Roadmap](https://github.com/storytold/deckcraft/blob/main/ROADMAP.md)
- [ONLYOFFICE DocumentServer](https://github.com/ONLYOFFICE/DocumentServer) · [ONLYOFFICE Community-Lizenz-FAQ](https://helpcenter.onlyoffice.com/docs/faq/docs-community.aspx)
