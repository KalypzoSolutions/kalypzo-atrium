# Projektstand (zuletzt aktualisiert: 2026-10-16)

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
- **Platzhalter-Module (2026-10-18)**: `files` (Dateien, Cloud-Ablage) und `orders` (Bestellungen, seit 2026-10-19 umgesetzt) – nur Manifest, Navigation und eine Seite „In Planung“, keine Endpoints/Migrationen.
  **Geplant `files`**: Ablage (Ordner, Up-/Download, „Meine Dateien“ + Stammesordner), Freigabe an Benutzer (Lesen/Bearbeiten, `ShareMenu`-Muster), Link-Freigabe (Ablauf, Passwort, widerrufbar, rate-limitiert; **offen: auch für Personen ohne Konto?**), Quota, Papierkorb; kein Sync/Versionen/Mitbearbeiten.
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
  Bekannt (nicht durch `orders`): E2E `annual-fee.spec.ts` (sucht alten Kassen-Tab „Jahresbeitrag“) und `pdf-lists.spec.ts` (Auswahl leer) schlagen fehl.
- **Verwaltung unter `/admin` (2026-10-19)**: alle Verwaltungsseiten unter `/admin` (Übersicht mit Abschnitten und Suche, Benutzer, Rollen + Reiter
  Berechtigungen, Einstellungen mit Reitern Allgemein/Design/E-Mail-Versand/E-Mail-Layout/Speicher/KI/PDF/**Module**, Module, API-Keys + Reiter
  API-Übersicht, Audit-Log, Zurücksetzen). Registry `layout/admin-registry.ts` als einzige Quelle für Seitenleiste (Gruppe „Administration“ mit
  „Übersicht“), Übersicht, Reiter (`LinkTabs`) und **Befehlspalette** (Strg+K, Topbar „Suchen“). Alte URLs → 308 (`core/admin-redirects.ts`).
  Neuer Reiter Einstellungen → Module (generische Modul-Einstellungen, Module mit eigener Seite wie Kasse als Link). Tests
  `tests/unit/admin-{registry,redirects}.test.ts`, E2E `admin-nav.spec.ts` (+ `admin.spec.ts`/`api-docs.spec.ts` auf neue URLs). Details: `architecture.md`.
- Modul-Details (Dateien, Datenmodell, Rechte, API, Regeln): `rules/module-members.md`, `rules/module-actions.md`, `rules/module-treasury.md`, `rules/module-events.md`.

## Entscheidungen des Nutzers (nicht ungefragt ändern)
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
7. **Aktionen auf Principal-Freigabe umstellen** (nach Abschluss der parallelen `actions`-Arbeiten): `action_shares(user_id)` → Muster
   `<obj>_shares(principal_type, principal_id)` mit `principalKeysFor`/`principalMatchSql`, `ShareMenu` mit `type`. Termine: Seite (Liste/Monat) fertigstellen.
3. Aufräumen: Git-Initial-Commit, Schema-/Doku-Aktualisierung, ggf. `docs/` um das Modul `actions` ergänzen.

## Bekannte Eigenheiten
- Es gibt noch keinen Git-Commit; Branch `master` (Zielbranch `main`).
- Dokument-/Bild-Upload braucht konfiguriertes S3 (sonst `503 unavailable`) – Demo: MinIO per `docker-compose.demo.yml` (siehe `workflow.md`).
- Demo-Daten sind Testdaten (Benutzer `tessa@demo.test`, `tom@demo.test`, Aktion „Kopenhagen 2026“).
