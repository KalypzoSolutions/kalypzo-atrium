# Projektstand (zuletzt aktualisiert: 2026-10-15)

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
  Carlito eingebettet); Admin `/pdf` zeigt Vorlagen mit Vorschau/Bestandteilen (nur Ansicht); Abrechnungsbericht nutzt `stamm-briefkopf`.

- **Rückzahlung des Überschusses** (Migration 0006/0007): Überschuss an Teilnehmende zurück, je Person auf ganze Euro
  abgerundet, nur wenn je Person > 5 € bleiben, manuelle Personenzahl möglich; Hinweis „erst nach Eingang aller
  Zahlungen“ nur im PDF-Bericht; „Zahlung an Personen“ = nur „als ausgezahlt markieren“. **Backend (`count`/`mode` in
  `refund.endpoints.ts`) war bei Doku-Stand (2026-10-15) noch in Arbeit.** Details: `rules/module-actions.md`.
- Modul-Details (Dateien, Datenmodell, Rechte, API, Regeln): `rules/module-members.md`, `rules/module-actions.md`.

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
2. ~~**Phase 4 – Abrechnung**~~ (erledigt, siehe oben). Bewusst später: **Zahlungseingänge je Teilnehmende*r in eigenem
   Modul** (Anbindung an die Abrechnung über eine Schnittstelle), endgültiges **Auszahlungs-Exportformat** (ggf. SEPA-XML).
3. Aufräumen: Git-Initial-Commit, Schema-/Doku-Aktualisierung, ggf. `docs/` um das Modul `actions` ergänzen.

## Bekannte Eigenheiten
- Es gibt noch keinen Git-Commit; Branch `master` (Zielbranch `main`).
- Dokument-/Bild-Upload braucht konfiguriertes S3 (sonst `503 unavailable`) – Demo: MinIO per `docker-compose.demo.yml` (siehe `workflow.md`).
- Demo-Daten sind Testdaten (Benutzer `tessa@demo.test`, `tom@demo.test`, Aktion „Kopenhagen 2026“).
