/**
 * Formular-Definition und Werte. Framework-neutral: keine Modul-, Server- oder Svelte-Imports;
 * läuft im Browser und auf dem Server. Siehe `.claude/rules/forms.md`.
 */

export const FIELD_TYPES = [
	'text',
	'textarea',
	'number',
	'email',
	'phone',
	'date',
	'select',
	'multiselect',
	'boolean',
	'info',
	'consent'
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldOption {
	value: string;
	label: string;
}

interface BaseField {
	/** Technische ID (stabil innerhalb der Definition, nur für UI-Schlüssel/Sortierung) */
	id: string;
	/** Schlüssel der Antwort (eindeutig, `[a-zA-Z][a-zA-Z0-9_]{0,39}`); Antworten werden unter `key` gespeichert */
	key: string;
	label: string;
	help?: string;
	required?: boolean;
	/** Standardfeld des Hosts: nicht löschbar, Typ und Schlüssel fix (Label/Hilfetext/Pflicht ggf. änderbar) */
	locked?: boolean;
	/** Nicht anzeigen und nicht abfragen (z. B. deaktiviertes Standardfeld) */
	hidden?: boolean;
	/** Bindung an ein Zusatzfeld des Mitglieds (Modul `members`): vorausgefüllt, Änderungen werden dort gespeichert */
	memberKey?: string;
}

export interface TextField extends BaseField {
	type: 'text';
	maxLength?: number;
	placeholder?: string;
}
export interface TextareaField extends BaseField {
	type: 'textarea';
	maxLength?: number;
	placeholder?: string;
}
export interface NumberField extends BaseField {
	type: 'number';
	min?: number;
	max?: number;
	/** Nur ganze Zahlen */
	integer?: boolean;
}
export interface EmailField extends BaseField {
	type: 'email';
}
export interface PhoneField extends BaseField {
	type: 'phone';
}
export interface DateField extends BaseField {
	type: 'date';
	/** ISO-Datum JJJJ-MM-TT */
	min?: string;
	max?: string;
}
export interface SelectField extends BaseField {
	type: 'select';
	options: FieldOption[];
	/** Zusätzlich „Andere …“ mit Freitext erlauben (Wert ist dann der eingegebene Text) */
	allowOther?: boolean;
}
export interface MultiselectField extends BaseField {
	type: 'multiselect';
	options: FieldOption[];
	min?: number;
	max?: number;
}
export interface BooleanField extends BaseField {
	type: 'boolean';
}
/** Reiner Anzeigetext ohne Antwort. */
export interface InfoField extends BaseField {
	type: 'info';
	text: string;
}
/** Pflicht-Zustimmung (Checkbox) mit Text und optionalem Link (z. B. Datenschutz). */
export interface ConsentField extends BaseField {
	type: 'consent';
	text: string;
	href?: string;
	linkLabel?: string;
}

export type FieldDefinition =
	| TextField
	| TextareaField
	| NumberField
	| EmailField
	| PhoneField
	| DateField
	| SelectField
	| MultiselectField
	| BooleanField
	| InfoField
	| ConsentField;

export interface FormDefinition {
	version: 1;
	title?: string;
	intro?: string;
	fields: FieldDefinition[];
	submitLabel?: string;
}

/** Wert einer Antwort. `null` = nicht beantwortet. */
export type FormValue = string | number | boolean | string[] | null;
export type FormValues = Record<string, FormValue>;

export type FormValidationResult =
	{ ok: true; values: FormValues } | { ok: false; errors: Record<string, string> };
