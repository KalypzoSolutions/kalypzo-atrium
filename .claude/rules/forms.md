---
paths:
  - "src/lib/forms/**"
  - "src/lib/components/forms/**"
  - "src/lib/modules/**/form*"
---

# Formular-Builder (wiederverwendbar) – Entwurf und Regeln

Anforderung des Nutzers: Der Formular-Builder ist **eine eigenständige, modulare Komponente**, die auch in anderen
Modulen (und später im Core) eingesetzt werden kann – nicht fest im Modul `actions` verdrahtet. „Wie Google Forms“:
Felder anlegen, sortieren, Pflicht markieren, Vorschau, öffentliche Ausgabe. Erste Nutzung: Anmeldelink der Aktionen (Phase 3).

## Schichtung
```
src/lib/forms/                    framework-neutral, KEINE Modul- oder Server-Imports (läuft Browser + Server)
  types.ts                        FormDefinition, FieldDefinition (Union nach `type`), FieldValue, FormValues
  registry.ts                     Feldtypen-Registry: registerFieldType({ type, label, icon, create(), schema(field) })
  schema.ts                       buildFormSchema(def) → Zod-Schema; validateValues(def, values) → { ok, values, errors }
  conditions.ts                   (optional) showIf-Auswertung
  field-types/*.ts                text, textarea, number, email, phone, date, select, multiselect, boolean, info, consent
src/lib/components/forms/         UI auf Basis der Core-Bausteine
  FormRenderer.svelte             rendert eine FormDefinition (Eingabe + Fehler) – für Vorschau UND öffentliche Seite
  FormBuilder.svelte              Editor: Felder hinzufügen/sortieren/bearbeiten/löschen, Vorschau-Umschalter
  FieldEditor.svelte              Eigenschaften eines Feldes (Label, Hilfetext, Pflicht, Optionen, Länge …)
  FieldPalette.svelte             Auswahl des Feldtyps (+ Neu)
```
Das **Modul** liefert nur: Speicherung der Definition (JSON) und der Antworten, Zuordnung „Standardfelder → eigene
Spalten“, Endpoints, Rechte. Der Builder kennt weder Datenbank noch API.

## Datenmodell
```ts
interface FormDefinition { version: 1; title?: string; intro?: string; fields: FieldDefinition[]; submitLabel?: string }
interface BaseField { id: string; key: string; type: string; label: string; help?: string; required?: boolean;
                      locked?: boolean /* Standardfeld: nicht löschbar, Typ fix */; hidden?: boolean;
                      mandatory?: boolean /* Pflicht-Standardfeld: weder ausblendbar noch optional (Host erzwingt) */;
                      health?: boolean /* Antwort = Gesundheitsdaten (Host speichert geschützt), Schalter im FieldEditor */ }
// Typen: text{maxLength} · textarea{maxLength} · number{min,max,step} · email · phone · date{min,max}
//        select{options} · multiselect{options,min,max} · boolean · info{text} · consent{text,required}
// `key` ist stabil (snake/camel, eindeutig) – Antworten werden unter `key` gespeichert, nicht unter `id`.
```
- Antworten: `Record<key, string | number | boolean | string[] | null>`.
- Die **Definition liegt immer serverseitig**; beim Absenden lädt der Server sie (per Token) und validiert gegen
  `buildFormSchema(def)` – Client-Definitionen werden nie vertraut.
- Strikt: unbekannte Schlüssel ablehnen (`.strict()`), Längen begrenzen, Optionen gegen Whitelist prüfen.
- Versionierung: Definition ändert sich nach ersten Antworten → Antworten behalten `key`; entfernte Felder bleiben lesbar
  (Antwort-Snapshot enthält `label`), neue Pflichtfelder gelten nur für neue Einreichungen.

## Erweiterbarkeit
- Neue Feldtypen **nur** über die Registry (`registerFieldType`): liefert Standardwerte, Zod-Schema und Anzeige-Komponenten
  (`Editor`, `Input`, `Display`). Renderer/Builder enthalten keine `switch(type)`-Ketten außerhalb der Registry.
- Hosts können `allowedTypes`, `lockedFields`, `maxFields`, `honeypot`, `readonly`, `labels` (Texte) übergeben.
- Standardfelder des Hosts (z. B. Name, Gruppe, Geburtsdatum) kommen als `locked`-Felder in die Definition; der Host mappt
  die Antworten per `key` auf seine Spalten, alle übrigen landen in einem JSON-Feld (`answers`).

## Renderer-Regeln
- Barrierefrei: `fieldset`/`legend` für Gruppen, Labels, `aria-describedby` für Hilfetexte/Fehler, Fokus aufs erste Fehlerfeld.
- Öffentlich nutzbar: keine App-Shell-Annahmen, nur `ui`-Bausteine; mobil zuerst; kein `{@html}` – Infotexte als Text
  (Zeilenumbrüche erlaubt, einfache Auszeichnung nur über eigenen, whitelisted Mini-Parser).
- Optionales Honeypot-Feld (verstecktes Eingabefeld, per CSS ausgeblendet, `aria-hidden`, `tabindex=-1`); Befüllung
  wertet der Host serverseitig als Spam.
- Eigenschaften (Props): `definition`, `values` ($bindable), `errors`, `disabled`, `readonly`, `onsubmit`, `submitting`.

## Tests (Pflicht)
`tests/unit/forms-*.test.ts`: Schema-Aufbau je Feldtyp (Pflicht, Grenzen, Optionen, unbekannte Schlüssel), Registry
(unbekannter Typ → Fehler), Rundlauf JSON → Definition → Validierung. Integration: Host-Modul-Endpoint mit Rate-Limit,
Honeypot, Duplikat, geschlossen/Frist/Plätze.
