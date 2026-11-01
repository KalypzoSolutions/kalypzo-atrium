import { z } from 'zod';
import './field-types';
import { t } from '$lib/i18n';
import { msg } from './field-types/shared';
import { getFieldType } from './registry';
import type {
	FieldDefinition,
	FormDefinition,
	FormValidationResult,
	FormValue,
	FormValues
} from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

// ---------------------------------------------------------------------------
// Definition (Builder/Speichern)
// ---------------------------------------------------------------------------

const optionSchema = z.strictObject({
	value: z
		.string()
		.min(1, msg('forms.definition.valueMissing'))
		.max(100, msg('forms.definition.maxChars', { max: '100' })),
	label: z
		.string()
		.min(1, msg('forms.definition.labelMissing'))
		.max(100, msg('forms.definition.maxChars', { max: '100' }))
});

const optionsSchema = z
	.array(optionSchema)
	.min(1, msg('forms.definition.minOneOption'))
	.max(50, msg('forms.definition.maxOptions', { max: '50' }))
	.superRefine((opts, ctx) => {
		const values = new Set<string>();
		const labels = new Set<string>();
		opts.forEach((o, i) => {
			if (values.has(o.value)) {
				ctx.addIssue({
					code: 'custom',
					message: t('forms.definition.valueDuplicate'),
					path: [i, 'value']
				});
			}
			if (labels.has(o.label)) {
				ctx.addIssue({
					code: 'custom',
					message: t('forms.definition.labelDuplicate'),
					path: [i, 'label']
				});
			}
			values.add(o.value);
			labels.add(o.label);
		});
	});

const baseShape = {
	id: z
		.string()
		.min(1, msg('forms.definition.idMissing'))
		.max(64, msg('forms.definition.maxChars', { max: '64' })),
	key: z.string().regex(KEY_RE, msg('forms.definition.invalidKey')),
	label: z
		.string()
		.min(1, msg('forms.definition.labelMissing'))
		.max(200, msg('forms.definition.maxChars', { max: '200' })),
	help: z
		.string()
		.max(500, msg('forms.definition.maxChars', { max: '500' }))
		.optional(),
	required: z.boolean().optional(),
	locked: z.boolean().optional(),
	hidden: z.boolean().optional(),
	memberKey: z.string().regex(KEY_RE, msg('forms.definition.invalidKey')).optional(),
	mandatory: z.boolean().optional(),
	health: z.boolean().optional()
};

const lengthSchema = z.number().int().min(1).max(10000).optional();
const placeholder = z.string().max(200).optional();
const dateSchema = z.string().regex(ISO_DATE, msg('forms.definition.invalidDate')).optional();
const finite = z.number().finite().optional();

function minMax<T extends { min?: number | string; max?: number | string }>(v: T): boolean {
	return v.min === undefined || v.max === undefined || v.min <= v.max;
}

const fieldSchema = z.discriminatedUnion('type', [
	z.strictObject({
		...baseShape,
		type: z.literal('text'),
		maxLength: lengthSchema,
		placeholder
	}),
	z.strictObject({
		...baseShape,
		type: z.literal('textarea'),
		maxLength: lengthSchema,
		placeholder
	}),
	z
		.strictObject({
			...baseShape,
			type: z.literal('number'),
			min: finite,
			max: finite,
			integer: z.boolean().optional()
		})
		.refine(minMax, { ...msg('forms.definition.minGreaterMax'), path: ['min'] }),
	z.strictObject({ ...baseShape, type: z.literal('email') }),
	z.strictObject({ ...baseShape, type: z.literal('phone') }),
	z
		.strictObject({ ...baseShape, type: z.literal('date'), min: dateSchema, max: dateSchema })
		.refine(minMax, { ...msg('forms.definition.minGreaterMax'), path: ['min'] }),
	z.strictObject({
		...baseShape,
		type: z.literal('select'),
		options: optionsSchema,
		allowOther: z.boolean().optional()
	}),
	z
		.strictObject({
			...baseShape,
			type: z.literal('multiselect'),
			options: optionsSchema,
			min: z.number().int().min(0).max(50).optional(),
			max: z.number().int().min(1).max(50).optional()
		})
		.refine(minMax, { ...msg('forms.definition.minGreaterMax'), path: ['min'] }),
	z.strictObject({ ...baseShape, type: z.literal('boolean') }),
	z.strictObject({
		...baseShape,
		type: z.literal('info'),
		text: z.string().max(10000, msg('forms.definition.maxChars', { max: '10000' })),
		format: z.literal('html').optional()
	}),
	z.strictObject({
		...baseShape,
		type: z.literal('section'),
		text: z
			.string()
			.max(500, msg('forms.definition.maxChars', { max: '500' }))
			.optional()
	}),
	z.strictObject({
		...baseShape,
		type: z.literal('consent'),
		text: z.string().max(2000, msg('forms.definition.maxChars', { max: '2000' })),
		href: z
			.string()
			.max(500, msg('forms.definition.maxChars', { max: '500' }))
			.refine((v) => {
				try {
					const u = new URL(v);
					return u.protocol === 'http:' || u.protocol === 'https:';
				} catch {
					return false;
				}
			}, msg('forms.definition.invalidUrl'))
			.optional(),
		linkLabel: z
			.string()
			.max(100, msg('forms.definition.maxChars', { max: '100' }))
			.optional()
	})
]);

/**
 * Zod-Schema einer Formular-DEFINITION (für Speichern im Builder): Feldtypen, eindeutige `key`/`id`,
 * Optionen, Grenzen, maximal 60 Felder, Textlängen.
 */
export const formDefinitionSchema = z
	.strictObject({
		version: z.literal(1),
		title: z
			.string()
			.max(120, msg('forms.definition.maxChars', { max: '120' }))
			.optional(),
		intro: z
			.string()
			.max(2000, msg('forms.definition.maxChars', { max: '2000' }))
			.optional(),
		fields: z.array(fieldSchema).max(60, msg('forms.definition.maxFields', { max: '60' })),
		submitLabel: z
			.string()
			.max(60, msg('forms.definition.maxChars', { max: '60' }))
			.optional()
	})
	.superRefine((def, ctx) => {
		const ids = new Set<string>();
		const keys = new Set<string>();
		def.fields.forEach((f, i) => {
			if (ids.has(f.id)) {
				ctx.addIssue({
					code: 'custom',
					message: t('forms.definition.idDuplicate'),
					path: ['fields', i, 'id']
				});
			}
			if (keys.has(f.key)) {
				ctx.addIssue({
					code: 'custom',
					message: t('forms.definition.keyDuplicate'),
					path: ['fields', i, 'key']
				});
			}
			ids.add(f.id);
			keys.add(f.key);
		});
	}) as unknown as z.ZodType<FormDefinition>;

// ---------------------------------------------------------------------------
// Antworten
// ---------------------------------------------------------------------------

/** Sichtbare, beantwortbare Felder (nicht `hidden`, keine Anzeige-Typen wie `info`/`section`). */
export function visibleFields(def: FormDefinition): FieldDefinition[] {
	return def.fields.filter((f) => !f.hidden && getFieldType(f.type).hasValue);
}

/** Anzuzeigende Felder in Reihenfolge (nicht `hidden`), inkl. Infotexte und Abschnitte. */
export function displayFields(def: FormDefinition): FieldDefinition[] {
	return def.fields.filter((f) => !f.hidden);
}

/** Feld hat eine Antwort (kein reiner Anzeige-Typ) */
export function fieldHasValue(f: FieldDefinition): boolean {
	return getFieldType(f.type).hasValue;
}

/** Leere Startwerte je Feld (`''`, `false`, `[]`, `null`). */
export function emptyValues(def: FormDefinition): FormValues {
	const out: FormValues = {};
	for (const f of visibleFields(def)) {
		switch (f.type) {
			case 'text':
			case 'textarea':
			case 'email':
			case 'phone':
			case 'date':
			case 'select':
			case 'number':
				out[f.key] = '';
				break;
			case 'boolean':
			case 'consent':
				out[f.key] = false;
				break;
			case 'multiselect':
				out[f.key] = [];
				break;
			default:
				out[f.key] = null;
		}
	}
	return out;
}

function isEmpty(v: unknown): boolean {
	if (v === undefined || v === null) return true;
	if (typeof v === 'string') return v.trim() === '';
	if (Array.isArray(v)) return v.length === 0;
	return false;
}

function valueSchema(field: FieldDefinition): z.ZodType {
	const spec = getFieldType(field.type);
	const inner = spec.schema(field);
	const required = field.required === true;
	const confirm = field.type === 'boolean' || field.type === 'consent';
	return z.unknown().transform((v, ctx) => {
		if (isEmpty(v) || (required && v === false)) {
			if (required) {
				ctx.addIssue({
					code: 'custom',
					message: confirm ? t('forms.validation.confirm') : t('forms.validation.required')
				});
				return z.NEVER;
			}
			if (isEmpty(v)) return null;
		}
		const r = inner.safeParse(v);
		if (!r.success) {
			ctx.addIssue({
				code: 'custom',
				message: r.error.issues[0]?.message ?? t('forms.validation.invalid')
			});
			return z.NEVER;
		}
		return r.data as FormValue;
	});
}

/** Striktes Zod-Schema der Antworten: `Record<key, Wert>`; unbekannte Schlüssel werden abgelehnt. */
export function buildFormSchema(def: FormDefinition): z.ZodType<FormValues> {
	const shape: Record<string, z.ZodType> = {};
	for (const f of visibleFields(def)) shape[f.key] = valueSchema(f);
	const dropped = new Set(def.fields.filter((f) => !shape[f.key]).map((f) => f.key));
	const strict = z.strictObject(shape, {
		error: (iss) =>
			iss.code === 'unrecognized_keys' ? t('forms.validation.unknownField') : undefined
	});
	return z.preprocess((raw) => {
		if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
		const copy: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(raw)) {
			if (!dropped.has(k)) copy[k] = v;
		}
		for (const k of Object.keys(shape)) copy[k] ??= null;
		return copy;
	}, strict) as unknown as z.ZodType<FormValues>;
}

/** Validiert Rohwerte gegen die Definition und liefert Werte oder Fehler je `key` (deutsche Texte). */
export function validateFormValues(def: FormDefinition, raw: unknown): FormValidationResult {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		return { ok: false, errors: { _form: t('forms.validation.invalid') } };
	}
	const result = buildFormSchema(def).safeParse(raw);
	if (result.success) return { ok: true, values: result.data };
	const errors: Record<string, string> = {};
	for (const issue of result.error.issues) {
		if (issue.code === 'unrecognized_keys') {
			for (const k of issue.keys) errors[k] ??= t('forms.validation.unknownField');
			continue;
		}
		const key = typeof issue.path[0] === 'string' ? issue.path[0] : '_form';
		errors[key] ??= issue.message;
	}
	return { ok: false, errors };
}

const TRANSLIT: Record<string, string> = {
	ä: 'ae',
	ö: 'oe',
	ü: 'ue',
	Ä: 'Ae',
	Ö: 'Oe',
	Ü: 'Ue',
	ß: 'ss',
	ẞ: 'SS'
};

/** Aus einer Bezeichnung einen Schlüssel ableiten (`Wohnort Bremen` → `wohnortBremen`), ASCII, ≤ 40 Zeichen. */
export function slugKey(label: string): string {
	const ascii = label
		.replace(/[äöüÄÖÜßẞ]/g, (c) => TRANSLIT[c] ?? c)
		.normalize('NFD')
		.replace(/\p{M}+/gu, '');
	const words = ascii.split(/[^a-zA-Z0-9]+/).filter(Boolean);
	let key = words
		.map((w, i) => {
			const lower = w.toLowerCase();
			return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
		})
		.join('');
	if (!key) return 'field';
	if (!/^[a-zA-Z]/.test(key)) key = 'field' + key.charAt(0).toUpperCase() + key.slice(1);
	return key.slice(0, 40);
}
