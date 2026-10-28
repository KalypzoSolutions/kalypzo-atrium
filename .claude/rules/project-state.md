# Projektstand (zuletzt aktualisiert: 2026-10-28)

## Fertig
- **Core**: Auth (2FA), RBAC, Modulverwaltung, Einstellungen, REST + OpenAPI, API-Keys, Audit, Storage (S3), PDF, KI.
- **Core-Erweiterungen**: Sidebar mit Gruppen (`group`/`groupIcon`, Administration einklappbar), `core.users.directory`,
  `core.crypto.forModule`, Modul-UI-Routen mit `:param`, Migrations-Runner mit Statement-Splitting, `DATABASE_POOL_MAX`.
- **UI-Bausteine** (siehe `ui-design.md`): `DataTable`, `SelectField`, `MultiSelect`, `ColorPicker`, `ColorBadge`, `EntityAvatar`,
  `FileField`, `ContactListField`, `NumberStepper`, `Slider`, `MoneyInput`, `SummaryList`, `CostBar`, `ShareDialog`/`ShareMenu`/`SharePanel`.
  Alle Core-Seiten nutzen `DataTable`/`SelectField`; bits-ui-Zustandsattribute in allen `ui/*`-Komponenten korrigiert.
- **Modul `members`** (Mitglieder & Gruppen): Mitglieder mit mehreren benannten Telefonen/E-Mails, Stand, Gruppen,
  Einwilligungen, Dokument-Uploads; Gruppen mit Leitern, Wochentag/Uhrzeit, Farbe, Bild. Regel: ab der ersten Gruppe
  braucht jedes Mitglied ≥ 1 Gruppe; Gruppen brauchen ≥ 1 Leiter (Mitglied).
- **Modul `actions`** (Aktionen) – Phasen 0–2: Aktionen (Name, Beschreibung, Ort, Start/Ende mit optionaler Uhrzeit),
  Freigabe an Benutzer (Lesen/Bearbeiten, `ShareMenu` im Kopf), Teilnehmende manuell, **Kalkulation** (Posten je
  einmalig/pro Person/pro Person und Nacht, Team zahlt X %, Puffer %, Programm je Kopf aufgerundet, Zuschuss nach
  Richtlinie 2026 inkl. Teamer*innen 12–27, Taschengeld, Förder-Checkliste, Autosave) und **Beitrag übernehmen**
  (`fee_cents`/`team_fee_cents` an der Aktion; `outdated`-Erkennung).

- **Phase 3 – Anmeldelink (fertig)**: Core-Opt-in `public: true` für Modul-Endpoints (Pflicht-Rate-Limit, nur GET/POST,
  JSON-Content-Type), öffentliche Seiten `/p/<modul>/<pfad>` über `ui.ts` `publicRoutes`, `core.mail.send`.
  Wiederverwendbarer **Formular-Builder**: Bibliothek `src/lib/forms/` (Typen, Feldtyp-Registry, Validierung) +
  Komponenten `src/lib/components/forms/` (`FormBuilder`, `FormRenderer`, `FieldEditor`, `FieldPalette`).
  Modul `actions`: Tab „Anmeldung“ (Builder, Link kopieren/erneuern, Frist, Plätze, Datenschutz-URL, Disclaimer mit
  Platzhaltern), öffentliche Seite `/p/actions/anmeldung/<token>`, Duplikatschutz (Name + Geburtsdatum), Bestätigungs-Mail,
  CSV-Export, Eingänge als Teilnehmende (Quelle „Anmeldelink“). Kontodaten stehen in den Modul-Einstellungen
  (`actions.bank.*`, `PUT /api/v1/settings` mit `{ values: {…} }`).

- **Phase 4 – Abrechnung (fertig)**: Tab „Abrechnung“ je Aktion: Buchungen (Einnahmen/Ausgaben, Kategorien wie die
  Kalkulation plus Beiträge/Zuschuss/Sonstige), Soll/Ist-Vergleich aus der Kalkulation, digitale Belege (Upload über
  Modul-Endpoint), „bezahlt von“ Stamm oder Person, Empfänger mit verschlüsselter IBAN (`core.crypto`, Anzeige maskiert,
  Klartext nur mit `actions.payout.view`), Auszahlung markieren/zurücknehmen, Auszahlungsliste als CSV (**Format vorläufig**),
  Abschluss mit Sperre (409 auf Änderungen), Wieder-Öffnen nur Eigentümer*in/`edit-all`, PDF-Bericht ohne Bankdaten.
  Datei-Uploads in Tests über `tests/helpers/fake-storage.ts`; PDF über `setPdfRendererForTests`.

- **Briefvorlagen (fertig)**: Stamm-Briefkopf fest im Code (`core/pdf/templates/stamm-briefkopf.ts`, `stamm-brief.ts`, Bausteine `parts/stamm.ts`,
  Carlito eingebettet); Admin `/admin/settings/pdf` (früher `/pdf`) zeigt Vorlagen mit Vorschau/Bestandteilen (nur Ansicht); Abrechnungsbericht nutzt `stamm-briefkopf`.
  Neu (2026-10-17): Quer-Variante `stamm-briefkopf-quer` (A4 quer, ohne Adressfeld/Falzmarken, für breite Tabellen/Listen;
  `page.orientation`, `createStammTemplate({ orientation })`), Admin-Vorschau quer mit Badge „Quer“.

- **Rückzahlung des Überschusses** (Migration 0006/0007): Überschuss an Teilnehmende zurück, je Person auf ganze Euro
  abgerundet, nur wenn je Person > 5 € bleiben, manuelle Personenzahl möglich; Hinweis „erst nach Eingang aller
  Zahlungen“ nur im PDF-Bericht; „Zahlung an Personen“ = nur „als ausgezahlt markieren“. **Backend (`count`/`mode` in
  `refund.endpoints.ts`) war bei Doku-Stand (2026-10-15) noch in Arbeit.** Details: `rules/module-actions.md`.
- **Konto-Verknüpfung (members, Migration 0003)**: Benutzer ↔ Mitglieder (n:m) per Brief-PDF (QR, Link, 6-stelliger Code, 90 Tage), öffentliche
  Seite zum Verknüpfen/Konto anlegen (Rolle „Mitglied“), Sammel-PDF per Bulk-Aktion; Core: PDF-Bildblock, `pdf.generateMany/merge`, `qr`, `app.origin`,
  `users.registerWithRole`. Noch nicht genutzt: Anmeldung für Kinder in `actions` (Basis `GET /my/members`).
- **Gruppen optional, Zusatzfelder, Anmeldung mit Mitglied**: Mitglieder brauchen keine Gruppe mehr; vordefinierte Zusatzfelder (Ernährung, Allergien, Medikamente …) pro Mitglied;
  Anmeldelink kann ein verknüpftes Mitglied wählen (Vorbelegung, Rückschreiben) oder per „Anmeldung erzwingen“ Login + Mitglied verlangen; `actions` hängt hart von `members` ab
  (Core: `ModuleDefinition.provides`, `core.modules.use`). Offen: Verschlüsselung der Gesundheitsfelder, mehrere Kinder in einem Durchgang.
- **Modul `treasury` – Kasse (2026-10-16)**: Konten (Giro/Bar) mit Buchungen, Umbuchungen und Belegen; Rechnungen je
  Teilnehmende*r **automatisch aus Aktionen** (stündlicher Abgleich) oder manuell (`R-JJJJ-NNNN`, PDF); Zuordnung von
  Zahlungen auf beliebige Posten (**Sammelzahlung für Geschwister**), Zahler/Familien inkl. Vorschlägen; CSV-Import
  (Sparkasse CSV-CAMT u. a.) mit Duplikatschutz und Zuordnungsvorschlägen; Zahlungsbestätigung und zweistufige
  Erinnerungen per Mail (täglicher Job); Offene Posten (CSV), Kontolage, Zeitraumbericht (PDF/CSV). `actions` zeigt in der
  Abrechnung die **tatsächlich eingegangenen Beiträge** (Ist statt Soll). Details: `rules/module-treasury.md`.
  **Ausbaustufe 2**: Standardkonto, Einstellungen unter Administration, Zahler-IBAN (Import-Abgleich), Auszahlungen
  (Eingangsrechnungen, Auslagen mit Rückkanal in die Abrechnung, Rückzahlungen, Guthaben), Rechnungs-PDF an der Anmeldebestätigung
  mit automatischer „Geänderte Rechnung“, Offene Posten als Tabelle. Core: Mail-Anhänge (PDF), `crypto.hash`, Modul-Nav `admin`.
  **Ausbaustufe 3**: Mails und Rechnungs-PDF neu gestaltet (Zahlungskasten, GiroCode, Verwendungszweck), Bankdaten **nur**
  aus den Kassen-Einstellungen (auch für die Anmeldebestätigung), Zahler lernen aus zugeordneten Buchungen (IBAN-Feld +
  Autovervollständigung), Rückzahlung aufs Herkunftskonto, Sammelrechnung je Zahler, Belege bei Auszahlungen, Ablage
  abgeschlossener Aktions-Abrechnungen im Tab Berichte. Danach: neue Buchung direkt zuordnen (Einnahme → offene Rechnungen,
  Ausgabe → offene Auszahlung) mit automatischen Vorschlägen; „Zahlung erfassen“ mit Zahler-Autovervollständigung und IBAN.
  **Ausgaben aus Abrechnungen (2026-10-16)**: Stamm-Ausgaben sind offen (außer „Bereits bezahlt“), mit Empfänger/IBAN/Zweck,
  und werden sofort Auszahlung in der Kasse; Auslagen erst mit Abschluss; Kassen-Tab „Abrechnungen“ mit Detailansicht.
- **Mobil, Aufgabenliste, Verlauf, Mitglieds-PDFs (2026-10-17)**: `DataTable mobile="cards"` + `MobileActionBar`, Dialoge `max-h 100dvh`, Touch-Ziele (`pointer: coarse`);
  Kasse-Übersicht mit Aufgabenliste (`Overview.tasks`), Jahresbeitrag als 4 Schritte (`AnnualSteps`, `AnnualChecklist`), Rückgängig-Toasts (`pages/undo.ts`),
  Verlauf (`GET /history`, Audit-Filter `target`); Jahresbeitrag-Rechnung hat **einen** Posten „Stammesbeitrag“ (Aufschlüsselung in `annual_fee_items`, Migr. 0006);
  Datenblatt-PDFs `POST /members/sheets.pdf`, `POST /groups/sheets.pdf`, `GET /actions/:id/participants.pdf` (Recht `members.data.export`, Gesundheitsdaten enthalten).
- **Mitgliedschaft & Jahresbeitrag (2026-10-16)**: `members` Migration 0006 (Eintritt/Austritt, Zweitmitglied mit
  Beitragsebenen Stamm/Gau/Landesmark/Bund = hier gezahlte Ebenen), Statusfilter aktiv/ausgetreten/alle, Bearbeiten-Dialog
  in Tabs, schreibgeschützte Ansicht per Zeilenklick (Bearbeiten-Dialog mit gesperrten Feldern, seit 2026-10-17 statt Sheet). `treasury`: Tab „Jahresbeitrag“ (Läufe je Jahr, Stichtag =
  Erstellungsdatum, Eintritt nach 28.02. → nur Stamm, Sammelrechnung je Zahler, PDF mit Aufschlüsselung, Mail mit PDF,
  Versand zum Datum per stündlichem Job, Nachholen), Sätze 12/8/2/25 € in den Einstellungen. Core: Tabs `line` brechen um
  (`tabs-list.svelte`), sr-Text „Schließen“, CSP `frame-src 'self' blob:` (PDF-Vorschau im iframe).
- **Vergangene Aktionen und vorab erstattete Auslagen (2026-10-18)**: Beim Anlegen/Bearbeiten einer Aktion gibt es die Checkbox
  „liegt bereits in der Vergangenheit“ (`actions.is_past`, Migr. 0012; Vorschlag, wenn Ende bzw. Start < heute). Für solche Aktionen legt
  die Kasse **keine Rechnungen/offenen Posten** an (`planSync` friert sie ein: bestehende Rechnungen bleiben unberührt, kein Storno/Guthaben/Mail),
  `invoiceForRegistration` liefert `null` (Anmeldebestätigung ohne Rechnungs-PDF/Zahlungsblock). Ausgaben „bezahlt von Person“ lassen sich beim Erfassen
  als **bereits erstattet** markieren (`entryInput.reimbursed` → `reimbursed_at = now()` + `reimbursed_upfront`, Migr. 0013): keine Kassen-Auszahlung;
  bei vergangenen Aktionen sind das und „Bereits bezahlt“ (Stamm-Ausgabe) vorbelegt. Alle übrigen Auslagen/Stamm-Ausgaben/Rückzahlungen/Guthaben
  erscheinen weiter als ausstehende Überweisungen der Kasse. Rücknahme der Kassen-Zahlung lässt vorab erstattete Auslagen erstattet
  (sonst Doppelzahlung); Erstattung der Person zurücknehmen (`DELETE …/payees/:id/reimburse`) macht alle wieder offen/editierbar. Details: `module-actions.md`, `module-treasury.md`.
  Gefixt nebenbei: `ImportActionDialog` löste mit `$effect` + `fieldKey++` eine Endlosschleife aus (Aktionsliste hing), E2E `tests/e2e/actions-list.spec.ts`.
  Tabellen in PDFs: dünnere Linien (0,5-px-Schatten), Zellen zusammenfassen (`colspan`/`rowspan`, `PdfTableCell`).
- **Profil-Ausbau (2026-10-17)**: `/profile` mit Tabs Konto / Darstellung / Sicherheit plus Karten aus Modulen.
  **Konto**: Name, Profilbild (`/avatar/<id>`, PNG/JPEG/WebP ≤ 2 MB, Magic-Bytes, braucht S3), **E-Mail-Wechsel mit Passwort + Bestätigungslink**
  an die neue Adresse (1 h), Info-Mail an die alte; der HTTP-Weg `/api/auth/change-email` und `/update-user` ist gesperrt (nur Server-Actions).
  **Darstellung**: Theme-Sync (Cookie + `core.user.theme`), Akzentfarbe, Dichte, Einträge pro Seite (Audit, Benutzerliste), Startseite
  (`core.user.*`, Scope `user`). **`profileSections`-Mechanismus** (Modul-`ui.ts`, Props `{ userId }`, Auswahl `selectProfileSections`):
  `members` liefert **Meine Mitglieder** (Kontakte + Zusatzfelder der verknüpften Mitglieder, Entwurf + Speichern, **kein Autosave**) und
  **Benachrichtigungen je Mitglied** (nur die **Zahlungsbestätigung** ist abschaltbar; Rechnungen, Jahresbeitrag, Erinnerungen und
  Anmeldebestätigung sind verbindlich). Neue Rechte `members.own.view|edit`; Rolle „Mitglied“ bekommt sie über **`defaultRoleGrants`**
  (einmalig je Modul/Rolle/Recht, Marker `role_grant_applied`, Core-Migration 0004). Änderung von Kontakten löst eine **Info-Mail an die alten
  Adressen** aus. Sicherheitsfunde der Prüfung (Konto-Orakel, Session über Bestätigungslink/2FA, fremde Avatar-Pfade, Rate-Limits) behoben.
  Core: `toastWithUndo` jetzt in `components/layout`, `EntityAvatar` mit Fehler-Action statt `onerror` (CSP). Details: `rules/module-members.md`, `docs/security.md`.
- **Zwischenabrechnungen, Kosten-Link, Admin-Reset (2026-10-18)**: Aktionen: „Zwischenabrechnung Nr. N“ als eingefrorenes Abbild des Gesamtstands (Migr. 0014/0016, unabhängig
  voneinander, keine Sperre, enthaltene Auslagen sofort in die Kasse, PDF-Download, Rücknahme jeder ZA mit Recht); Kosten-Link je Aktion (Migr. 0015, öffentliche Seite `/p/actions/auslagen/<token>`, Einreichung mit Beleg + IBAN, Prüfung vor Übernahme).
  Core: öffentliches Multipart (`ApiEndpoint.multipart`), Admin-Seite **Zurücksetzen** (`/admin/reset`, früher `/system/reset`, Bereiche je Modul + Core, Vorschau, Passwort/TOTP,
  Pflicht-JSON-Export, Bestätigungswort, `ConfirmDialog`), `core.storage.purge`, Jobs pausierbar, Core-Migration 0005. Details: `architecture.md`,
  `module-actions.md`, `module-treasury.md`. Offen: Reset-Token nur bei einer Instanz; Buchungsbelege der Kasse bei Teil-Reset verwaist; ZA nicht im Export/Import.
- **Platzhalter-Module (2026-10-18)**: `files` (Dateien, Cloud-Ablage, seit 2026-10-19 umgesetzt, siehe „Modul `files` – Dateien“ unten) und `orders` (Bestellungen, seit 2026-10-19 umgesetzt) – damals nur Manifest, Navigation und eine Seite „In Planung“, keine Endpoints/Migrationen.
  **Geplant `orders`**: Mitglieder bestellen interne Artikel (Halstuch, Liederbuch …); Zuständige mit Lager- und Bestellverwaltung; Rechnung an das zugeordnete Mitglied (Konto-Verknüpfung, Mail) und an die Kasse (`treasury`-Rechnung/Zuordnung).
- **Core**: Hintergrundjobs (`ModuleDefinition.jobs`, `core/jobs`, Tabelle `job_run`, `/api/v1/jobs`), optionale
  Modul-Abhängigkeiten (`optionalDependencies`, `core.modules.useOptional`); `members` liefert `listMemberContacts`,
  `actions` liefert `listReceivableSources`/`listActionRefs` (`actions/contract.ts`).
- **Modul `events` – Termine (2026-10-18)**: Termine (Titel, Beschreibung, Ort, Farbe, Start/Ende mit optionaler Uhrzeit), freie Tags
  (`TagInput`, Vorschläge `GET /tags`), Zuordnung zu „ganzer Stamm“ (`stamm`, Name aus Einstellung `events.stamm.name`) und `members`-Gruppen,
  Sichtbarkeit/Bearbeitung über **Freigabe an Principals** (Stamm, Gruppe, Rolle, Benutzer*in, Mitglied; `read|edit`), Eigentümer*in, `view-all`/`edit-all`,
  Rolle „Mitglied“ bekommt `events.event.view` (`defaultRoleGrants`). Website: `GET /website/events` nur mit Recht/Scope `events.website.read`
  (API-Key der Stammeswebsite, serverseitig abrufen, nur öffentliche Felder). Core dazu: `$lib/sdk/{types,server}/sharing.ts`, `core.roles.directory`,
  `core.users.roleIds`, `members`-Dienste `listGroups`/`principalIdsForUser`/`searchMembers`; UI `SharePanel` & Co. mit `type`/`everyoneLabel`,
  `TagInput`, `MonthCalendar`. UI: Liste/Monat, Dialog, Ansicht, E2E. Details: `rules/module-events.md`.
  **Serien (2026-10-18, Migr. 0002, v1.1.0)**: Wiederholungstermine täglich/wöchentlich (Wochentage)/monatlich/jährlich mit Intervall und Ende
  (nie/bis/Anzahl), einzelne Vorkommen absagen oder ändern (`/events/:id/occurrences/:date`), Website liefert jedes Vorkommen einzeln
  (`recurring`, `occurrenceDate`), Vorschlag „Gruppenstunde übernehmen“; Ansicht als gesperrtes Popup (Dialog statt Sheet) mit Auswahl
  „Nur diesen Termin / Ganze Serie“, **Monat ist Standardansicht** (`?view=list` für die Liste). Offen: kein „diesen und folgende“.
- **Modul `galleries` – Galerien (2026-10-18)** (Termine hängen an der **ganzen Galerie**, nicht an einzelnen Bildern; Migr. 0002): Galerien mit Bildern (Upload je Datei ≤ 25 MB, Beschreibung je Bild),
  Titelbild (Standard = zuerst hochgeladenes Bild, änderbar), Zuordnung von Bildern zu Terminen (`events`-Dienst `EventRefsService`),
  Freigabe an Principals wie `events` plus Sichtbarkeit **öffentlich/privat**; öffentliche Galerien per API-Key (`galleries.website.read`)
  inkl. Bilddateien `thumb`/`web` für die Website (serverseitig). Core: `core.images.process` (sharp, Metadaten/GPS entfernt, Varianten).
  Details: `rules/module-galleries.md`.
- **API-Übersicht (2026-10-18)**: Admin-Seite `/admin/api/docs` (früher `/api-docs`, Recht `core.api.view`) mit allen REST-Endpunkten, automatisch aus der Registry
  (`core/api/catalog/`, Vertrag `src/lib/api-docs/types.ts`): Rechte, Rate-Limits, Schemas, abgeleitete Fehler, Beispiel-JSON, Konsole zum
  Ausprobieren mit eigener Session (Mutationen mit Bestätigung). Details: `docs/api.md`. Offen: viele Endpunkte haben kein `response`-Schema.
- **Modul `offices` – Ämter (2026-10-19)**: Ämter mit Beschreibung, eigener Reihenfolge (neu am Ende, Umsortieren per Ziehen/Pfeilen), E-Mail-Adressen,
  verknüpften Rollen und Inhaber*innen (Konten, „seit“, Reihenfolge); **eine** persönliche Beschreibung je Person für alle Ämter (`/me/bio`, Profilkarte „Meine Ämter“).
  Inhaber*innen erhalten die Rollen ihrer Ämter **plus** Rolle „Amtsinhaber*in“ (`offices.office.view`) über die neue Core-Tabelle `user_role_grant`
  (Migration 0006, `core.roles.replaceModuleGrants|listModuleGrants|assertCanGrant`), nur bei aktivem Modul, manuelle Rollen bleiben; `core.users.roleIds`
  enthält verliehene Rollen; Rechteausweitung → 403; stündlicher Abgleich-Job. Website: `GET /website/offices` + Avatar (Scope `offices.website.read`,
  keine Benutzer-Mails/Rollen). Tests `offices*.test.ts`, E2E `offices.spec.ts`, Demo `scripts/seed-demo-offices.mjs`. Details: `rules/module-offices.md`.
- **Ämter aus Modulen + Benachrichtigungen (2026-10-19)**: Module bringen Ämter als **Vorlage** mit (`manifest.offices`, `ModuleOfficeTemplate`);
  `offices` legt sie einmal an (Marker `office_templates_applied`, Migr. 0002), danach normales Amt – gelöscht → nicht neu angelegt. Benachrichtigungen per
  `OfficesService.notify` (über `provides`, Aufrufer mit `optionalDependencies: ['offices']`) an die **Konto-Adresse** der Inhaber*innen; Modus je Person
  und Ereignis **Sofort / Täglich (Zusammenfassung) / Aus** (Standard Sofort) **nur im Profil** („Meine Ämter“ → „Benachrichtigungen“), Bündelung je
  Aufruf, Tagesjob `offices.notify-digest`. Ämterseite: Badge „Vorlage: <Modul>“, Hinweis im Dialog und in der Lösch-Bestätigung. Erste Nutzerin:
  Kasse (Amt `kasse`, Ereignisse `payable-created`, `accounting-closed` inkl. Zwischenabrechnung, ausgelöst auch aus `actions`). Details:
  `module-offices.md`, `module-treasury.md`. Offen: echter SMTP-Versand und Tagesjob im Echtbetrieb ungeprüft.
- **Modul `orders` – Bestellungen / Kämmerer*in (2026-10-19)**: ersetzt den Platzhalter. Artikel mit optionalen Größen (eigene Preise → Preisspanne),
  Bildern, internen Notizen und Nachbestelllinks; Benutzer bestellen für verknüpfte Mitglieder (Kämmerer*in für alle) → Rechnung **sofort** über die Kasse
  (Push `TreasuryService.upsertOrderInvoice`, Kasse-Migration 0007, Herkunft „Bestellung“); Ausgabe aus dem Lager auch teilweise; Lager mit Fehlmengen und
  Bestellvorschlag; Einkauf mit Teillieferung, Lieferantenrechnung als Auszahlung (`upsertOrderPayable`) mit Bezahlstatus. Amts-Vorlage „Kämmerer*in“
  (Benachrichtigungen neue Bestellung / Fehlmengen), Rolle „Kämmerer*in“ per `defaultRoleGrants`. Details: `rules/module-orders.md`.
- **Verwaltung unter `/admin` (2026-10-19)**: alle Verwaltungsseiten unter `/admin` (Übersicht mit Abschnitten und Suche, Benutzer, Rollen + Reiter
  Berechtigungen, Einstellungen mit Reitern Allgemein/Design/E-Mail-Versand/E-Mail-Layout/Speicher/KI/PDF/**Module**, Module, API-Keys + Reiter
  API-Übersicht, Audit-Log, Zurücksetzen). Registry `layout/admin-registry.ts` als einzige Quelle für Seitenleiste (Gruppe „Administration“ mit
  „Übersicht“), Übersicht, Reiter (`LinkTabs`) und **Befehlspalette** (Strg+K, Topbar „Suchen“). Alte URLs → 308 (`core/admin-redirects.ts`).
  Neuer Reiter Einstellungen → Module (generische Modul-Einstellungen, Module mit eigener Seite wie Kasse als Link). Tests
  `tests/unit/admin-{registry,redirects}.test.ts`, E2E `admin-nav.spec.ts` (+ `admin.spec.ts`/`api-docs.spec.ts` auf neue URLs). Details: `architecture.md`.
- **Modul `files` – Dateien (2026-10-19)**: ersetzt den Platzhalter. Cloud-Ablage mit „Meine Dateien“ (Kontingent `files.quota.mb`, Standard 1 GB) und
  Stammesordner (`files.shared.view|edit`); Ordner/Dateien als Baum (virtuelle Wurzeln, eindeutige Namen je Ordner), Upload auch ganzer Ordner per
  Drag & Drop, internes Verschieben per Ziehen, Vorschau für Bilder (Zoom/Blättern), PDF (Blob-iframe) und Text; Papierkorb mit Ablauf (`files.trash.days`,
  Job `files.purge-trash`). **Freigabe an Principals** (Stamm, Gruppe, Rolle, Mitglied, Benutzer*in; read/edit, vererbt) und **öffentliche Links** für Personen
  ohne Konto (`/p/files/link/<token>`, Ablauf, optionales Passwort, widerrufbar, rate-limitiert, nur ansehen/herunterladen; Token nur als Hash, 10 Fehlversuche/h
  → 429). Freigaben/Links nur für Bereichsberechtigte (nicht über eine edit-Freigabe). Rolle „Mitglied“ bekommt `files.file.view`. Kein Sync, keine Versionen,
  kein Mitbearbeiten, keine Videos. Offen u. a.: Link-Token im `api_log` (Core-Fix vorgeschlagen), `no-store` bei öffentlichen Thumbnails. Details: `rules/module-files.md`.
  **Umbau 2026-10-19 (Migr. 0003, v1.1.0)**: **eine Ansicht** „Dateien“ (eigene + mir freigegebene Einträge in der Wurzel, Papierkorb über Knopf im
  Seitenkopf) statt Meine Dateien/Stamm/Mit mir geteilt; Stammesordner abgeschafft → Freigabe `everyone:*` („Mit dem ganzen Stamm teilen“), Rechte
  `files.shared.*` entfallen, alte Stamm-Ordner gehören der anlegenden Person und sind an den Stamm (Lesen) freigegeben (Bearbeiten-Rechte früherer
  `files.shared.edit`-Rollen werden **nicht** übertragen). Link-URL **jederzeit** abrufbar (`token_enc`), Link-Arten Ansehen / Hochladen / Ansehen und
  hochladen (Upload nur für Ordner); **öffentlicher Upload** mit optionalem Namen (Eigentum/Kontingent der Ordner-Eigentümer*in, ≤ 10 Dateien/30 MB je
  Request, 20/600 s je IP); **Rechtsklick-Kontextmenü** über neue Core-Komponente `ui/context-menu`. Tests `files-upload-link.test.ts`, `files-migration.test.ts`.
- **Stammeswebsite `website/` (2026-10-19, neu entschieden)**: die **alte Website** (GitHub `edelweisspiraten-website`, Ordner `web/`)
  unverändert übernommen, **nur das Backend getauscht**: Termine/Galerien serverseitig aus den Website-Endpunkten (`website/src/lib/server/backend.ts`,
  `WEBSITE_API_URL` + `WEBSITE_API_KEY`), Bild-Proxy, Server-Route für die Gruppen-Terminvorschau; FAQ fest im Code, Download-Seite entfernt (308).
  Die zuvor neu gestaltete Website (Figuren/Motive) ist verworfen (Git-Historie). Compose/Seed/Doku auf `WEBSITE_API_*` umgestellt. Details: `rules/website.md`.
- **Datensicherung (2026-10-20)**: `/admin/backup` – verschlüsselter Gesamt-Export (alle oder einzelne Bereiche/Module, Dateien wählbar,
  inkl. Zugangsdaten) und Import als **Wiederherstellen** oder **Zusammenführen**, auch auf neuem Server mit anderem `APP_SECRET`.
  Recht `core.system.backup`, Reset-Suchbegriffe „Backup/Sicherung“ wandern hierher. Details: `architecture.md` → „Datensicherung“.
  Offen/Grenzen: kein Mehrinstanz-Betrieb, Dateien beim Import einzeln im RAM (≤ 2 GB je Datei), Merge ohne ID-Umschlüsselung/Duplikaterkennung,
  `onEnable` wird beim Übernehmen des Modulstatus nicht aufgerufen, `missingUserRefs` nur geschätzt, echtes S3 und große Sicherungen ungetestet.
- **Modulares Dashboard (2026-10-20)**: `/dashboard` setzt sich aus Kacheln zusammen (`ui.ts` `dashboardWidgets` + Core-Kacheln
  `src/lib/components/dashboard/`), nur aktive Module, nur mit Recht (Ämter wirken über ihre Rollen). Leere Kacheln (`onstatus('empty')`)
  werden zu „Nichts Neues bei …“ eingeklappt. „Anpassen“: ein-/ausblenden, sortieren, Standard (`core.user.dashboard`, `PUT /dashboard/layout`).
  Kacheln: Termine, Galerien, Ämter, Mitglieder (Geburtstage), Bestellungen (eigene + Kämmerer*in), Kassen-Aufgaben, **Meine offenen Rechnungen**
  (`treasury GET /my/invoices`, Recht `treasury.own.view`), **Meine Anmeldungen** (`actions GET /my/registrations`, `actions.own.view`),
  **Offene Abrechnungen** (`actions GET /accounting/open`), **Zuletzt geändert** (`files GET /recent`), Schnellzugriff, Kennzahlen, Aktivitäten.
  Neue Rechte per `defaultRoleGrants` an „Mitglied“. Offen: Kassen-Aufgabentexte doppelt (`treasury/pages/task-view.ts` + `OverviewTab.svelte`),
  ausgetretene verknüpfte Mitglieder fehlen in Rechnungen/Anmeldungen, Kacheln mit echten Daten nur per Integrationstest geprüft.
- **Globale Suche + Sidebar (2026-10-20)**: Befehlspalette findet neben Seiten auch Daten aller aktiven Module nach Rechten (Mitglieder, Gruppen,
  Aktionen, Termine, Galerien, Dateien/Ordner, Ämter, Artikel/Bestellungen, Rechnungen/Zahler, Benutzer*innen, Rollen); Deep-Links
  `members?open=`, `members/groups?open=`, `events?event=`, `treasury?payer=`. Sidebar scrollt auf Desktop (sticky) und mobil. Offen: Artikel/Bestellungen
  verlinken nur auf den Tab; Termin-Suche ohne Beschreibung; `?payer=` öffnet bei bereits offener Kasse nicht erneut.
- Modul-Details (Dateien, Datenmodell, Rechte, API, Regeln): `rules/module-members.md`, `rules/module-actions.md`, `rules/module-treasury.md`, `rules/module-events.md`.

- **Audit-Behebung (2026-10-21, Issues #3–#76, Label `audit-2026-10`)**: Sicherheit (Storage-API nur `core.storage.manage`, Schutz vor
  Rechteausweitung bei Kontoänderungen `assertCanManageUser`, Principal-Suche nur für Teilende ohne E-Mails/Kinder, sharp 0.35 + Magic Bytes +
  Loader-Sperre, Open-Redirect-Helfer, Auth-Rate-Limits in Form-Actions + `AUTH_RATE_LIMIT_FACTOR`, Client-IP aus `getClientAddress`, SMTP/KI/Storage-
  Secrets an Ziel gebunden, privilegierte Rechte `PRIVILEGED_PERMISSIONS`, Rollen per `role.system_key` (Migr. 0008), Link-Tokens nur als Hash,
  Modulverwaltung prüft `core.modules.manage`), Datenschutz (Gesundheitsdaten in Aktionen nur mit `members.data.export` + verschlüsselt, Lösch-Hooks
  `onUserDeleted`/`onMemberDeleted`, Aufbewahrungsjob `core.housekeeping` (Migr. 0007), Einwilligungen ausgewertet, Double-Opt-in für anonyme
  Anmeldungen, Datenauskunft `/admin/privacy`, Löschfristen, EXIF-freie Avatare/Gruppenbilder), Betrieb (CI `.github/workflows/ci.yml`, Dependabot,
  `.gitattributes` + zeilenendenfeste Prüfsummen, Compose-Limits/Backups/MinIO-Trennung, Health mit DB), Kasse (Abgleich nur Job/„Jetzt abgleichen“
  + gezielt je Aktion, Mahnlauf mit Reservierung, SQL-Pagination, Jahresbeitrag im Hintergrund), Designsystem (Status-Tokens, Guard-Test für alle
  Module, FormField-ARIA, Lade-/Fehlerzustände, Fokus/Skip-Link), Codequalität (`$lib/sdk/{dates,csv,file-names,iban}`, `sdk/server/{db,upload,
  share-access,file-response,best-effort}`), ESLint-Modulgrenzen, Tests (Job-Resilienz, Migrations-Upgrades, hooks/REST, optional echtes PostgreSQL
  über `TEST_DATABASE_URL`). E2E `annual-fee`/`pdf-lists` repariert. Offene Punkte und Entscheidungen: Abschlussbericht der Audit-Behebung.

- **Gruppenleitung in `members` (2026-10-21, v1.11.0, Migr. 0015)**: Neue Rechte `members.led-member.view|edit|export`; Konten, deren **eigenes** Mitglied
  eine Gruppe leitet, bekommen automatisch die Rolle „Gruppenleitung“ (`user_role_grant`) und sehen/bearbeiten in „Mitglieder“ nur die Mitglieder ihrer
  Gruppen (inkl. Dokumente, Gesundheits-Zusatzfelder, PDF-Listen). „Eigenes Konto“ setzt nur die Verwaltung (Eltern nie). Gruppen und Mitgliedschaftsdaten
  bleiben für Leitungen gesperrt, kein Anlegen/Löschen. Core: Modul-Navigation kennt `anyPermission`. Details: `module-members.md` → „Gruppenleitung“.
- **Mitgliederliste: Filter und „Alle Treffer auswählen“ (2026-10-21)**: Mehrfachauswahl bei Ständen und Gruppen (mindestens eine/alle, „Ohne Gruppe“), ausklappbare
  erweiterte Suche (Alter, Eintritt, Einwilligungen, Zweitmitglied, E-Mail), `GET /members/ids` (+ `/led/members/ids`) für die Auswahl **aller** Treffer
  (≤ 2000), Sammelaktionen/PDF-Listen bis 2000 IDs (`BULK_MAX_IDS`, `SHEETS_MAX_IDS`; Briefe weiter 100). Details: `module-members.md`. Offen: Laufzeit großer PDF-Listen/Sammelaktionen
  bei ~2000 Personen ungeprüft; E2E und Screenshot-Prüfung der neuen Filterleiste.

- **Sidebar aufgeräumt (2026-10-21)**: flache Liste ohne Gruppen, fest sortiert über `ModuleNavigationItem.order` (Termine, Galerien, Dateien,
  Bestellungen, Mitglieder, Gruppen, Nachrichten, Aktionen, Ämter, Kasse); Gruppe „Stamm“ entfällt. Zusatzfelder/Löschfristen (`members`) unter
  Administration › Module (`admin: true`); `settingsPage: true` markiert echte Einstellungsseiten (Kasse) für Einstellungen → Module. „Administration“
  ist nach jedem Laden zu (Gruppenknopf hervorgehoben, wenn die aktive Seite darin liegt). Rechte filtern wie bisher.

- **Posteingang in `messages` (2026-10-22, v1.1.0, Migr. 0003)**: Catch-all-Postfach per IMAP (Job jede Minute), Zuordnung zu persönlichen/Amts-/Gruppen-/
  Stamm-Postfächern (Sichtbarkeit wie Absenderrechte), „Nicht zugeordnet“ für die Verwaltung, Antworten/Weiterleiten mit Verlauf (In-Reply-To),
  Benachrichtigungen „Neue Nachricht“ und „… hat geantwortet“ je Person im Profil abschaltbar. Core: Intervall-Jobs, Message-ID/In-Reply-To beim Versand,
  `core.permissions.usersWith`, `secretBoundTo`. Details: `module-messages.md` → „Posteingang“.

- **Ordner im Posteingang (2026-10-23, `messages` v1.2.0, Migr. 0004)**: Ordner mit Unterordnern (≤ 3 Ebenen) je Postfach, in gemeinsamen
  Postfächern für alle mit Zugriff gemeinsam; Drag & Drop (Mails und Ordner), Rechtsklick-Menüs, Sammelaktionen, Rückgängig. Details:
  `module-messages.md` → „Ordner im Posteingang“.

- **Dateien: Ordner-Aussehen und Kontingent je Person (2026-10-23, `files` v1.2.0, Migr. 0004)**: Ordner mit Icon (alle Lucide-Icons über die neue
  Core-Icon-Bibliothek `IconPicker`/`DynamicIcon`, `$lib/sdk/icons`) und Farbe (Vorschläge + `ColorPicker`), für alle mit Zugriff gleich; Rasteransicht mit
  gleich hohen Karten und Umbrüchen an `_ - .` (auch öffentliche Link-Seite); Kontingent je Person im Dialog „Benutzer bearbeiten“ (neuer Core-Mechanismus
  `userAdminSections`, Recht `files.quota.manage`). Details: `module-files.md`.

- **Lagerbeiträge in Aktionen (2026-10-24, `actions` v1.4.0, Migr. 0021)**: Kategorien „Lagerbeitrag Gau / Landesmark / Bund“ in Kalkulation (Gruppe
  „Lagerbeiträge“, Standard pro Person) und Abrechnung (Ausgaben, Soll/Ist, eigener PDF-Abschnitt, offene Stamm-Ausgabe → Auszahlung in der Kasse).

- **Spam-Schutz im Posteingang (2026-10-24, `messages` v1.3.0, Migr. 0005)**: eigene Bewertung beim Abruf (Punkte + Gründe: gefälschte Absender,
  gefährliche Anhänge, irreführende Links, Massenversand …), bekannte Absender nie Spam (außer Absenderprüfung schlägt fehl), „Spam“/„Kein Spam“ mit
  gemeinsamer Sperr-/Vertrauensliste, Verwaltung „Spam-Schutz“, Links in Spam unklickbar, Spam nach 30 Tagen gelöscht. Details: `module-messages.md`.

- **Kalender-Abo (iCal) im internen Bereich (2026-10-24, `events` v1.3.0, Migr. 0004)**: mehrere Abos je Person mit geheimem Link (Hash + verschlüsselt,
  erneuerbar), Filter nach Gruppen/Tags, Termine (Serien je Vorkommen, Absagen/Änderungen) und Aktionen (sichtbare + eigene Anmeldungen), Profilkarte und
  Dialog auf der Terminseite, Webcal/Google-Links. Details: `module-events.md` → „Kalender-Abo“.

- **Modul `website` + Design-Feinschliff der Stammeswebsite (2026-10-25, v1.0.0)**: Banner (Leiste auf allen Seiten oder Kasten Startseite, Zeitfenster,
  schließbar), häufige Fragen (Rich-Text, Startseite/alle) und Blog (Bilder im Text, Titelbild, Themen, Entwurf/geplant/veröffentlicht, Mitschreiben per
  Freigabe, Vorname der Autor*in, Verknüpfung Gruppen/Termin/Galerie) im Intern-Bereich; Website mit `/blog`, `/blog/<slug>`, `/blog/rss.xml`, `/faq`,
  Banner-Leiste, statischer Ferienhinweis entfällt. Core: `sanitizeRichText`/`slugify` im SDK, Bilder im `RichTextEditor`, `GalleryRefsService`.
  Website-Feinschliff: Typo-Skala (`text-display|section|sub|lede|small`), `site-container`, Fokus/Skip-Link/Reduced-Motion, Altseiten auf Tokens.
  Details: `module-website.md`, `website.md`.

- **Benachrichtigungen im Core + Web Push / PWA (2026-10-25, Core-Migr. 0010)**: zentraler Dienst `core.notifications` für alle Module; je Person und
  Benachrichtigung Regler Aus · E-Mail · Beides · Push (+ Sofort/Täglich) im Profil-Reiter „Benachrichtigungen“; App installierbar (Manifest, Service
  Worker, Icons aus dem Wappen), Push auf Android und iOS ≥ 16.4 (Home-Bildschirm); VAPID automatisch; Admin-Reiter Einstellungen → Benachrichtigungen.
  Umgestellt: `offices` (Amts-Hinweise inkl. Tageszusammenfassung), `messages` (Posteingang), `actions` (Kosten-Link), `members` (Konto verknüpft),
  `treasury` (zusätzlich Push an verknüpfte Konten). Offen: echte Geräte (Android/iPhone) nur nach Deploy mit HTTPS prüfbar; kein Offline-Modus.
  **Weitere Benachrichtigungen (2026-10-25)**: Aktionen (neue Anmeldung, eigene Anmeldung als Push, geteilt, Abrechnung), Termine (neu/verschoben/abgesagt,
  Standard aus), Galerie/Ordner geteilt, Upload über Link, Bestellung angelegt/ausgegeben/storniert, Blog (Mitschreiben, veröffentlicht/zurückgezogen).
  Neu im SDK `principalUserIds`/`addedPrincipals`, Core `core.roles.userIds`.

- **Kontaktformular → Posteingang (2026-10-25, `messages` v1.4.0)**: Website-Kontaktformulare (Start + `/kontakt`) legen Anfragen über den neuen,
  per API-Key-Scope `messages.website.contact` abgesicherten Endpunkt ins Stamm-Postfach (Benachrichtigung wie bei Mails); Spam-Schutz Proof-of-Work +
  Zeitfalle + Einmal-Aufgabe, dazu Honeypot/Rate-Limits; SMTP nur noch Rückfall. Details: `module-messages.md`, `website.md`.

- **Probestunden-Formular (2026-10-25, `messages` v1.5.0)**: Website-Seite `/probestunde` (Kind, Alter, Kontakt, Telefon) → Posteingang der zum Alter
  passenden bzw. gewählten Gruppe (Leitungen werden benachrichtigt), Rückfall Stamm-Postfach; Spam-Schutz wie beim Kontaktformular. Details: `module-messages.md`.

- **Aktionen an Gruppen freigeben + Modul `tasks` (2026-10-25)**: `actions` v1.5.0 (Migr. 0022) teilt an Principals (Stamm, Gruppe, Rolle,
  Mitglied, Benutzer*in) wie Termine/Galerien; neuer Dienst `accessibleActions`. Neues Modul **Aufgaben** (Kanban): Boards mit freien Spalten,
  Aufgaben mit mehreren Zuständigen, Fälligkeit, Priorität und Unteraufgaben (Checkliste), Freigaben, Board je Aktion (Zugriff vererbt),
  „Meine Aufgaben“ im Dashboard, Erinnerung an fällige Aufgaben. Details: `module-tasks.md`, `module-actions.md`.

- **Dateien: Typ-Symbole und echte Vorschau (2026-10-26, `files` v1.3.0, Migr. 0005)**: Dateien zeigen Symbol + Farbe + Endungs-Kürzel je Typ
  (PDF, Word, Tabelle, Präsentation, Bild, Archiv, Audio/Video, Code; Tokens `--file-*`); PDFs bekommen ein Vorschaubild der ersten Seite (neuer
  Core-Baustein `core.pdf.renderPage`, pdf.js + `@napi-rs/canvas`), Bestand per Job `files.thumbs-backfill`. Details: `module-files.md`.

- **Persönliche Design-Themes (2026-10-26)**: Profil → Darstellung → „Theme“: 10 Vorschläge, eigene Themes (≤ 20) mit Akzentfarbe und Hintergrund je
  Modus (einfarbig, linearer/radialer Verlauf mit 2–6 Farben, Farbflecken), Abdeckung, Seitenleiste durchscheinend/getönt/einfarbig, Live-Vorschau,
  Kontrastwarnung, „Dunkel aus Hell ableiten“; Schnellwahl im Darstellungs-Menü der Kopfzeile **nur für mit Stern markierte Themes** (Favoriten). Hell/Dunkel/System und Akzentfarbe bleiben wie bisher.
  Core-Baustein `GradientEditor`. Details: `architecture.md` → „Konto, Darstellung“, `ui-design.md`. Offen: `theme-color`-Meta folgt dem Theme nicht;
  Safari/iOS (feste Ebene, Weichzeichner) ungeprüft.

- **Modul `whiteboard` – Whiteboards (2026-10-26, v1.0.0)**: Whiteboards anlegen und **live mit mehreren Personen** bearbeiten (SSE-Stream +
  gebündelte Änderungen, zuletzt geschrieben gewinnt je Element, Live-Cursor/Auswahl der anderen, Wiederverbinden mit Nachholen): Notizzettel und
  Formen in Farben, Text, Verbinder (an Formen gebunden, gerade/gewinkelt/gebogen, Pfeilspitzen, Beschriftung), Freihand (Stift/Marker/Radierer),
  Rahmen, Bilder und Dateien (Upload, Drag & Drop, Einfügen), Links, Karten aus Aktionen/Aufgaben/Terminen/Galerien/Dateien/Whiteboards (je
  Betrachter*in aufgelöst), Versionsverlauf (stündlich + benannt, Wiederherstellen), Teilen an Principals, **mehrere Boards je Aktion** (Karte in der
  Aktion), Export PNG/SVG/PDF und Archiv `.epwhiteboard` mit Import, Touch (Pinch, Stift, Long-Press). Core: `ModuleUi.fullBleedRoutes` (vollflächige
  Modulseiten), Verträge `TaskRefsService`, `FileRefsService`, `GalleryRefsService.*Cards`; nginx-Location für SSE. Neue Abhängigkeit `perfect-freehand`.
  Details: `module-whiteboard.md`. Offen: nur **eine** App-Instanz (Hub im Prozess), echte Tablets/Stifte und SSE hinter Traefik nach Deploy ungeprüft.

- **Zuschussantrag in Aktionen (2026-10-26, `actions` v1.6.0, Migr. 0023)**: Abrechnung → „Zuschussantrag“ erzeugt das Original-Formular des
  Landesjugendpfarramts (BEK) fertig ausgefüllt als PDF; bei mehr als 20 Kindern bzw. 20 Jugendlichen (inkl. Team) mehrere Anträge, je Antrag eine
  weibliche und eine männliche Leitung. Details: `module-actions.md` → „Zuschussantrag“. Offen: mit dem Landesjugendpfarramt klären, ob die
  Aufteilung (Team in der Jugendliste des eigenen Antrags) so akzeptiert wird; Vorlage ändert sich ggf. jährlich (Koordinaten neu ausmessen).

- **Kasse mobil – Handy und Tablet (2026-10-26)**: Umsetzung des Konzept-Artifacts „Kasse mobil – Bedienkonzept“. Handy: Bereichsleiste unten,
  Pillen, Blätter von unten (Ziehen/Zurück schließt nur das Blatt), Listen statt Tabellen mit Aktionsblatt und Auswahl per langem Drücken, Zahlung erfassen
  in 3 Schritten, Rechnung mit fester Aktionsleiste. Tablet: Liste | Details, Menüs als Popover, Zahlung erfassen als zweispaltiger Dialog. Desktop
  unverändert. Neue Core-Bausteine `BottomSheet`, `SheetAction`, `MobileTabBar`, `ScrollPills`, `ChoiceChips`, `TouchList`/`ListRow`, `SelectionBar`,
  `longpress`, `deviceLayout`, `sheetsSettled` (`App.PageState.sheet`). Details: `module-treasury.md` → „Handy und Tablet“. Offen: echte Geräte
  (iPhone/Android/iPad, Safari-Zurück-Wischgeste, Safe-Area) nur emuliert geprüft; Familienkonto bleibt Seitenblatt; Jahresbeitrag/Familien/Abrechnungen
  nutzen weiter die Karten-Tabellen.

- **Zuschussantrag: Taschengeld und Konto (2026-10-27)**: Taschengeld-Grenze zählt alle Personen auf dem Antrag inkl. Team (÷ 5 Kinder- bzw.
  ÷ 7 Jugendfreizeit, abgerundet) – auch in Kalkulation/Abrechnung; eigenes Konto für Zuschussanträge in den Modul-Einstellungen (Kontoinhaber, Bank,
  IBAN, BIC), Kontoinhaber wird jetzt mitgedruckt. Details: `module-actions.md`.

- **Stammeswebsite: SEO, Performance, Bot-Falle, Alter von/bis (2026-10-27)**: Gemeinde heißt „Ev. Kirchengemeinde Bremen-Hastedt“; CPD-Geschichte als
  Zeitstrahl; Hero abgedunkelt; Tags auf `/termine` im Menü „Tags“; `<dl>` repariert; `Seo`-Komponente mit JSON-LD, `robots.txt`/`sitemap.xml`/`llms.txt`;
  CSS inline, gzip, kleinere Bilder; Bot-Falle + zweites Honeypot-Feld. Backend: Gruppen-Alter als Zahlen von/bis (`members` Migr. 0017, v1.13.0),
  Probestunde ordnet danach zu; Gruppenbild `?size=thumb`. Details: `website.md`, `module-members.md`. Offen: Lighthouse/Rich Results erst nach Deploy,
  gzip hinter dem Proxy (ggf. `COMPRESS=0`), Bot-Falle nur je Prozess.

- **Rückzahlung spenden (2026-10-27, `actions` v1.7.0, Migr. 0024)**: je Person die Rückzahlung ganz/teilweise (ganze Euro) dem Stamm spenden – intern in der
  Abrechnung oder über Brief (PDF) mit QR-Code und öffentliche Seite `/p/actions/rueckzahlung/<token>`; Buchung und Kassen-Auszahlung umfassen nur den
  Rest, Bericht mit Block „An den Stamm gespendet“. **Rückmeldefrist** (Migr. 0025, v1.8.0): bis zum Fristtag Link offen und Kasse wartet, danach wird
  ausgezahlt; intern weiter änderbar. Details: `module-actions.md` → „Rückzahlung spenden“. Offen: Spendenquittung, Benachrichtigung bei Wahl.

- **Modul `material` – Materialverwaltung (2026-10-27, v1.0.0)**: Bestand mit Lagerorten (Baum), Kategorien, Artikeln als **Einzelstücke** (eigener
  Code `M-…`) **oder Menge** (Bestand je Ort/Kiste), Kisten als verschachtelbare Behälter mit Packliste (Soll/Ist), Zustand/Schaden, Ausmustern, Verlauf;
  **Zelt-Sets** aus konfigurierbaren Set-Typen (Kohte, Jurte …) mit Vollständigkeits-Ampel und Umbau; **direkte Reservierung** (frei oder je Aktion, Karte in
  der Aktion) mit Live-Verfügbarkeit je Tag und **freier Bahnen-Anfrage** („8 Kohtenbahnen“ – Zuteilung teilt möglichst wenige Sets auf); Ausgabe/Rückgabe
  per Scan (Kiste nimmt Inhalt mit, Zustand je Stück, Rest als verloren), überfällige Rückgaben (Tagesjob, Amt + Person); Scan-Seite (Handy-Kamera,
  USB-Scanner, QR öffnet `/modules/material/scan/<code>`), **Etiketten-Designer** (mm, Text mit Platzhaltern, QR/Code 128/DataMatrix, Logo, Rahmen, Linie)
  und Druck auf A4-Bögen (Startfeld) oder Etikettendrucker-Rollen, Leer-Etiketten mit vorab vergebenen Codes. Core: `core.pdf.labels` (freie
  Seitengröße), `$lib/sdk/labels`, `BarcodeScanner`/`listenForScanner`, bwip-js + barcode-detector (zxing-wasm selbst gehostet), CSP `'wasm-unsafe-eval'`,
  `Permissions-Policy camera=(self)`. Details: `module-material.md`. Offen: echte Handy-Kamera (iOS) und Etikettendrucker erst nach Deploy mit HTTPS.

- **Material neu gegliedert „Ausleihen zuerst“ (2026-10-27, v1.1.0, Migr. 0002)**: Bereiche Ausleihen (Katalog + Merkliste, Zelte als Typ × Anzahl) ·
  Meine Reservierungen · Reservierungsseite · Scannen · Lager (für alle mit Leserecht, „Wo ist …?“, Orte-Baum inkl. „Ohne Ort“) · Ausgabe & Rückgabe ·
  Etiketten; Gestaltung nach Taste Skill (App-Screens, „Achromatic ledger“) und Web-Interface-Guidelines-Review. Neu: Artikel-Codes `A-…` + Etiketten für
  Mengenartikel, Format L7159 (63,5 × 33,9 mm), Schwarz-Weiß-Wappen/-Lilie, senkrechte Linien im Designer, PDF Ausgabeliste und Bestandsliste.
  Details: `module-material.md`.

- **Material neu aufgebaut (2026-10-28, `material` v2.0.0, Migr. 0004)**: altes Modell (Stücke/Kisten/Mengen, Zelt-Sets, Ausgabe/Rückgabe, eigene
  Bereichsseiten) verworfen. Neu: Lager als große Tabelle mit **Typen** und **Lagerartikeln** (mit Anzahl, Typ optional), Kategorien mit Icon/Farbe
  (gemeinsam mit `files` über `$lib/sdk/style-presets.ts`), flache Lagerorte, Reservieren wie „Bestellen“ (Katalog + Warenkorb) nach Typ **und** Artikel
  für Aktion/Gruppe/Sonstiges, Zustand/Schäden, Bilder, Scannen (Kamera/USB) in Reservieren und Lager, Etiketten-Kacheln + Etikettgrößen, Exporte
  (Materialliste nach Kategorie/Ort, Packliste, Reservierungsübersicht als PDF/CSV). Details: `module-material.md`.

## Entscheidungen des Nutzers (nicht ungefragt ändern)
- Material (2026-10-28, ersetzt die Entscheidungen vom 2026-10-27): altes Modul **verworfen** (Altdaten gelöscht); Typen + Lagerartikel mit Anzahl,
  Typ optional; Reservieren wie „Bestellen“ nach Typ **und** Artikel, mit Zeitraum und Zweck Aktion/Gruppe/Sonstiges; **keine** Ausgabe/Rückgabe, **keine**
  Zelt-Sets; Zustand/Schäden und Bilder bleiben; Lagerorte flach; Reiter wie Bestellungen; Etiketten-Designer bleibt (Größen im Menü, Kacheln);
  Scannen per Kamera (QR/Strichcode, auch vom Bildschirm) oder USB; Artikel-Popup zentriert.
- Rückzahlung spenden (2026-10-27): Standard **auszahlen** (sofort an die Kasse); über den Link auszahlen, alles oder **einen Teil** spenden (ohne IBAN-Abfrage);
  Spende als **eigener Block** in der Abrechnung, keine zusätzliche Einnahme. Frist (2026-10-27): **Kasse wartet bis zum Fristablauf**, danach Link zu,
  **intern weiter änderbar**.
- Stammeswebsite (2026-10-27): Bot-Falle = versteckter Link + IP-Sperre (24 h) zusätzlich zum Formular-Honeypot; CPD-Zeitstrahl **ersetzt** die Akkordeons;
  Tags im Knopf „Tags“ (Gruppen bleiben Chips).
- Zuschussantrag (2026-10-27): Taschengeld-Grenze aus **allen** Personen auf dem Antrag (Leitungen zählen mit), korrekt abrunden;
  Antragskonto **ohne Rückfall** auf Stammkonto/Kasse.
- Kasse mobil (2026-10-26): Konzept-Empfehlungen übernommen – Bereichsleiste unten, keine Wischgesten, Zahlung erfassen in 3 Schritten, ＋ als Blatt
  mit 5 Wegen, Kontostand dauerhaft im Kopf; Desktop bleibt unverändert.
- Zuschussantrag (2026-10-26): Geschlecht der Leitungen **nur im Antrag** (kein Feld an Teilnehmenden/Mitgliedern); **Original-PDF befüllen**;
  fehlen Leitungspaare → **so viele Anträge wie möglich**, Rest als „nicht berücksichtigt“; Gemeinde als Einstellung, Art/Thema/Inklusion je Aktion.
- Whiteboard-Fläche (2026-10-26): **standardmäßig feste Farbe (Weiß)** unabhängig von Hell/Dunkel und Theme; je Person im Whiteboard umschaltbar
  (Weiß, Schwarz, eigene Farbe oder „wie Modus/Theme“).
- Whiteboards (2026-10-26): eigenes Modul; Dateien direkt hochladen **und** aus „Dateien“ verknüpfen; **mehrere** Boards je Aktion; erste Version
  mit Freihand, Live-Cursor/Anwesenheit, Rahmen, Versionsverlauf und Karten für Aufgaben, Termine, Galerien, Dateien und Aktionen.
- Themes (2026-10-26): **nur persönlich** (keine Stammes-Themes); Hintergrund wirkt auf **Seite + Seitenleiste**, Karten bleiben einfarbig;
  **je Modus eigener Hintergrund**, der Modus (Hell/Dunkel/System) bleibt getrennt wählbar.
- Aufgaben (2026-10-25): eigenes Modul + optional je Aktion ein Board; Spalten frei je Board (eine Erledigt-Spalte); Unteraufgaben als Checkliste;
  Aktionen-Freigabe wie bei Terminen (alle Principal-Typen).
- Kontaktformular (2026-10-25): Anfragen in den Posteingang „Stamm“; Spam-Schutz Proof-of-Work + Zeitfalle/Token (keine Inhaltsbewertung, kein Captcha).
- Stammeswebsite (2026-10-25, später am Tag): Redesign nach dem Konzept-Artifact „Stammeswebsite – Redesign-Konzept“ umgesetzt (Wolke/Tinte,
  Pillen, Bebas Neue für große Titel, Fotos als Kampagnen-Kacheln); ersetzt „Design nur Feinschliff“. Details: `website.md`.
- Benachrichtigungen (2026-10-25): Regler Aus · E-Mail · Beides · Push je Benachrichtigung („Aus“ nur bei abschaltbaren); alle an Konten gerichteten
  Benachrichtigungen laufen über den Core; Kassen-Mails an Kontaktadressen bleiben E-Mail, Push zusätzlich an verknüpfte Konten; VAPID automatisch.
- Website-Modul (2026-10-25): Banner je Eintrag als Leiste oder Startseiten-Kasten; Blog „ausführlich“ (Themen, RSS, Mitschreiben); getrennte Rechte
  (Inhalte / schreiben / veröffentlichen); Design nur Feinschliff, Konzept bleibt.
- Kalender-Abo (2026-10-24): Termine **und** Aktionen; mehrere Abos je Person mit Filter.
- Spam-Schutz (2026-10-24): eindeutiger Spam in den Spam-Ordner (nie verwerfen); eine Sperr-/Vertrauensliste für alle Postfächer; jede*r mit
  Zugriff darf „Spam“/„Kein Spam“ klicken und damit die Liste ändern.
- Dateien (2026-10-23): Ordner-Icon und -Farbe gelten für alle mit Zugriff; Kontingent je Person wird im Benutzer-Dialog gesetzt (Standard 1 GB);
  Icon-Bibliothek mit möglichst vielen Icons (alle Lucide-Icons).
- Posteingang-Ordner (2026-10-23): Ordner je Postfach; alle mit Zugriff auf ein gemeinsames Postfach sehen und bearbeiten dieselben Ordner.
- Posteingang (2026-10-22): IMAP-Abruf eines Catch-all-Postfachs (kein Webhook); Sichtbarkeit wie Absenderrechte; Unzuordenbares in einen Sammelordner
  für die Verwaltung; nach dem Import auf dem Mailserver in den Ablageordner verschieben (nicht löschen).
- Gruppenleitung (2026-10-21): Rechte **automatisch** über die Leitung einer Gruppe; Leitungen dürfen Dokumente verwalten und PDF-Listen erzeugen,
  **Gesundheitsfelder sehen/bearbeiten**, aber **keine Gruppenzuordnung** ändern und keine Mitglieder anlegen/löschen.
- Programm: Pro-Kopf-Preis wird **aufgerundet** auf volle Euro. Puffer in **Prozent**. Team zahlt einen **Prozentsatz**,
  Rest wird auf die Teilnehmenden umgelegt. Leitende 12–27 zählen beim Zuschuss als Teilnehmende.
- Kalkulation findet in der Regel **vor** der Anmeldung statt; Tab-Reihenfolge Übersicht → Kalkulation → Teilnehmende.
- Freigabe lebt im Menü im Seitenkopf (kein Tab). Farbwähler/Auswahlfelder: eigene Komponenten, keine nativen.
- Upload über Modul-Endpoint (multipart), Rechte je Bereich view/edit/delete, ESLint erlaubt `$lib/components/{ui,layout}` in Modulen.
- Zuschuss-Quelle: `Richtlinien Freizeitzuschüsse` (Bremische Evangelische Kirche, Stand 01.01.2026), Sätze in
  `actions/subsidy.ts` (`SUBSIDY_RATES_2026`) – jährlich prüfen, vor Produktivnutzung gegen das Original abgleichen.

## Offen / Nächste Schritte
1. ~~**Phase 3 – Anmeldelink**~~ (erledigt, siehe oben). Entscheidungen dazu:
   **Entschieden (2026-10-15):** nach dem Absenden Danke-Seite **und Bestätigungs-E-Mail** (braucht SMTP + E-Mail-Pflichtfeld);
   **doppelte Anmeldungen** (gleicher Name + Geburtsdatum) werden **abgelehnt** mit Hinweis; **Datenschutz** über einen
   **Link auf eine externe Datenschutzseite** + Pflicht-Checkbox (kein eigener Text im System).
   **Entschieden (2026-10-17) Profil:** Mitglieder werden **direkt im Profil** bearbeitet (Kontakte, Zusatzfelder); Mail-Einstellungen **je Mitglied und
   Kategorie**; E-Mail-Wechsel mit **Passwort + Bestätigungslink**. **Abweichung vom freigegebenen Plan:** Zahlungserinnerungen sind **verbindlich**
   (Empfehlung des Konzeptteams), im Plan waren sie abschaltbar – **Nutzer soll entscheiden**, ob sie abschaltbar werden.
2. ~~**Phase 4 – Abrechnung**~~ (erledigt). ~~Zahlungseingänge je Teilnehmende*r in eigenem Modul~~ → Modul `treasury`.
   Weiterhin offen: endgültiges **Auszahlungs-Exportformat** (ggf. SEPA-XML).
4. Kasse – mögliche Folgeschritte: Guthaben verrechnen/zurückzahlen, Aktions-Ausgaben aus der Abrechnung übernehmen,
   SEPA-Lastschrift/FinTS, Abschluss-Sperre (bewusst nicht gewünscht).
5. Jahresbeitrag/Mitglieder: PDF-Vorschau im iframe (CSP `blob:`) in allen Browsern prüfen; Nachholen nur manuell
   (kein automatisches Nachholen); `listMemberContacts` liefert höchstens 1000 Mitglieder (Grenze bei Wachstum anheben).
6. Profil/Benachrichtigungen – offene Punkte: Die Kategorie `action-info` ist definiert und im Profil schaltbar, wird aber **nirgends ausgewertet**
   (kein Versand). Rate-Limits (`core/rate-limit`) liegen im **Arbeitsspeicher** (Neustart setzt zurück, nicht instanzübergreifend).
   Manipulierte **alte `user.image`-Werte** werden nicht migriert (`readAvatar` liefert für fremde Pfade nur kein Bild). Weitere Mitglieder lassen sich
   nur per **Brieflink** verknüpfen (`/p/members/verknuepfen/<token>`; eine Seite `/claim` gibt es nicht). Die **Anmeldebestätigung** (`registration`) geht an
   die Formular-Adresse und lässt sich nicht je Mitglied abschalten. Zeitstempel am Benutzer und ein laufender E-Mail-Wechsel (`pendingEmail`) sind in der UI
   nicht ermittelbar. **Prettier-Warnungen** in der Windows-Arbeitskopie sind CRLF-Zeilenenden, kein Formatfehler.
7. ~~Aktionen auf Principal-Freigabe umstellen~~ (erledigt 2026-10-25, Migr. 0022).
3. Aufräumen: Git-Initial-Commit, Schema-/Doku-Aktualisierung, ggf. `docs/` um das Modul `actions` ergänzen.

## Bekannte Eigenheiten
- Branches `staging` (Arbeitsbranch, Autodeploy) und `main`; Dokploy deployt bisher ohne CI-Gate (Branch-Protection manuell einrichten).
- Dokument-/Bild-Upload braucht konfiguriertes S3 (sonst `503 unavailable`) – Demo: MinIO per `docker-compose.demo.yml` (siehe `workflow.md`).
- Demo-Daten sind Testdaten (Benutzer `tessa@demo.test`, `tom@demo.test`, Aktion „Kopenhagen 2026“).
