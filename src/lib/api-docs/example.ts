/**
 * Beispielwerte aus JSON-Schemas (API-Übersicht, Konsole). Reine Funktion, client-tauglich.
 */
import type { JsonSchema } from './types';

export interface ExampleOptions {
	/** Maximale Verschachtelungstiefe (Standard 6); tiefer → null */
	maxDepth?: number;
	/** Bei Objekten nur Pflicht-Properties ausgeben */
	requiredOnly?: boolean;
}

const DEFAULT_MAX_DEPTH = 6;
const EXAMPLE_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const DATE_PATTERNS = new Set(['^\\d{4}-\\d{2}-\\d{2}$', '^[0-9]{4}-[0-9]{2}-[0-9]{2}$']);

interface State {
	maxDepth: number;
	requiredOnly: boolean;
}

function isSchema(v: unknown): v is JsonSchema {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clone(v: unknown): unknown {
	if (v === null || typeof v !== 'object') return v;
	try {
		return JSON.parse(JSON.stringify(v)) as unknown;
	} catch {
		return null;
	}
}

function isNullSchema(s: JsonSchema): boolean {
	return (
		s.type === 'null' ||
		(Array.isArray(s.type) && s.type.length > 0 && s.type.every((t) => t === 'null'))
	);
}

/** allOf zusammenführen: Properties vereinigt, required vereinigt, sonst späterer Wert gewinnt */
function mergeAll(base: JsonSchema, parts: JsonSchema[]): JsonSchema {
	const out: JsonSchema = { ...base };
	delete out.allOf;
	for (const raw of parts) {
		if (!isSchema(raw)) continue;
		const part = raw.allOf ? mergeAll(raw, raw.allOf) : raw;
		const { properties, required, ...rest } = part;
		Object.assign(out, rest);
		if (properties) out.properties = { ...(out.properties ?? {}), ...properties };
		if (required) out.required = [...new Set([...(out.required ?? []), ...required])];
	}
	return out;
}

function pickType(s: JsonSchema): string | undefined {
	if (Array.isArray(s.type)) return s.type.find((t) => typeof t === 'string' && t !== 'null');
	if (typeof s.type === 'string') return s.type;
	if (s.properties || s.additionalProperties !== undefined) return 'object';
	if (s.items) return 'array';
	return undefined;
}

function exampleString(s: JsonSchema): string {
	switch (s.format) {
		case 'date':
			return '2026-01-31';
		case 'date-time':
			return '2026-01-31T12:00:00.000Z';
		case 'time':
			return '12:00:00';
		case 'email':
			return 'name@example.org';
		case 'uuid':
			return EXAMPLE_UUID;
		case 'uri':
		case 'url':
			return 'https://example.org';
	}
	if (typeof s.pattern === 'string' && DATE_PATTERNS.has(s.pattern)) return '2026-01-31';
	let text = 'text';
	const min = typeof s.minLength === 'number' && Number.isFinite(s.minLength) ? s.minLength : 0;
	if (text.length < min) text = text + 'x'.repeat(Math.min(min, 10_000) - text.length);
	if (typeof s.maxLength === 'number' && Number.isFinite(s.maxLength) && s.maxLength >= 0) {
		text = text.slice(0, s.maxLength);
	}
	return text;
}

function num(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function exampleNumber(s: JsonSchema, integer: boolean): number {
	const min = num(s.minimum);
	const exMin = num(s.exclusiveMinimum);
	const max = num(s.maximum);
	const exMax = num(s.exclusiveMaximum);

	let value: number;
	if (min !== undefined) value = integer ? Math.ceil(min) : min;
	else if (exMin !== undefined) value = integer ? Math.floor(exMin) + 1 : exMin + 1;
	else value = 0;

	if (max !== undefined && value > max) value = integer ? Math.floor(max) : max;
	if (exMax !== undefined && value >= exMax) {
		if (integer) value = Math.ceil(exMax) - 1;
		else {
			const lower = min ?? exMin;
			value = lower !== undefined && lower < exMax ? (lower + exMax) / 2 : exMax - 1;
		}
	}
	return value;
}

function build(input: JsonSchema, depth: number, st: State): unknown {
	if (depth > st.maxDepth) return null;
	let s = input;
	if (Array.isArray(s.allOf) && s.allOf.length > 0) s = mergeAll(s, s.allOf);

	if (Array.isArray(s.examples) && s.examples.length > 0) return clone(s.examples[0]);
	if (s.default !== undefined) return clone(s.default);
	if (s.const !== undefined) return clone(s.const);
	if (Array.isArray(s.enum) && s.enum.length > 0) {
		const first = s.enum.find((e) => e !== null);
		return clone(first === undefined ? null : first);
	}

	const variants = Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : null;
	if (variants) {
		const variant = variants.find((v) => isSchema(v) && !isNullSchema(v));
		if (!variant) return null;
		const { anyOf: _a, oneOf: _o, ...rest } = s;
		void _a;
		void _o;
		// Geschwister-Schlüssel (z. B. description) bleiben, die Variante bestimmt den Typ
		return build(mergeAll(rest, [variant]), depth, st);
	}

	if (isNullSchema(s)) return null;
	const type = pickType(s);
	switch (type) {
		case 'string':
			return exampleString(s);
		case 'integer':
			return exampleNumber(s, true);
		case 'number':
			return exampleNumber(s, false);
		case 'boolean':
			return false;
		case 'array': {
			if (!isSchema(s.items)) return [];
			let count = Math.min(Math.max(num(s.minItems) ?? 1, 1), 2);
			const maxItems = num(s.maxItems);
			if (maxItems !== undefined) count = Math.max(0, Math.min(count, Math.floor(maxItems)));
			if (count === 0) return [];
			if (depth + 1 > st.maxDepth) return null;
			const item = build(s.items, depth + 1, st);
			return Array.from({ length: count }, () => clone(item));
		}
		case 'object': {
			const out: Record<string, unknown> = {};
			const props = isSchema(s.properties) ? s.properties : {};
			const required = new Set(Array.isArray(s.required) ? s.required : []);
			for (const [key, prop] of Object.entries(props)) {
				if (st.requiredOnly && !required.has(key)) continue;
				out[key] = isSchema(prop) ? build(prop, depth + 1, st) : null;
			}
			return out;
		}
		default:
			return null;
	}
}

/**
 * Erzeugt einen plausiblen Beispielwert für ein JSON-Schema.
 * Reihenfolge: examples[0] > default > const > enum[0] > nach Typ. Wirft nie.
 * `null`/`undefined` als Schema → `undefined`; leeres Schema `{}` → `null`.
 */
export function exampleFromSchema(
	schema: JsonSchema | null | undefined,
	opts?: ExampleOptions
): unknown {
	if (schema === null || schema === undefined) return undefined;
	try {
		if (!isSchema(schema)) return null;
		const maxDepth =
			typeof opts?.maxDepth === 'number' && Number.isFinite(opts.maxDepth) && opts.maxDepth >= 0
				? Math.floor(opts.maxDepth)
				: DEFAULT_MAX_DEPTH;
		return build(schema, 0, { maxDepth, requiredOnly: opts?.requiredOnly === true });
	} catch {
		return null;
	}
}

/** Beispiel als eingerückter JSON-Text; '' wenn kein Beispiel (Schema fehlt) */
export function exampleJson(schema: JsonSchema | null | undefined, opts?: ExampleOptions): string {
	const value = exampleFromSchema(schema, opts);
	if (value === undefined) return '';
	try {
		return JSON.stringify(value, null, 2) ?? '';
	} catch {
		return '';
	}
}
