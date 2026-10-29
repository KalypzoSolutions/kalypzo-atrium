import { fail } from '@sveltejs/kit';
import { getDefinition, getPublicSettings, setSettings } from '$lib/server/core/settings/service';
import { isCoreError } from '$lib/server/core/errors';

export type FieldKind = 'text' | 'number' | 'boolean' | 'list' | 'json' | 'select' | 'color';

export interface FieldDescriptor {
	key: string;
	label: string;
	description?: string;
	secret: boolean;
	isSet: boolean;
	kind: FieldKind;
	/** Aktueller Wert; bei Secrets immer null */
	value: unknown;
	options?: string[];
	multiline?: boolean;
}

const SELECT_OPTIONS: Record<string, string[]> = {
	'core.pdf.defaultFormat': ['A3', 'A4', 'A5', 'Letter', 'Legal'],
	'core.pdf.defaultOrientation': ['portrait', 'landscape'],
	'core.ai.style.address': ['du', 'ihr', 'Sie']
};

/** Farbfelder (`#rrggbb`): Oberfläche mit ColorPicker und Kontrastanzeige */
const COLOR_KEYS = new Set(['core.design.accentColor', 'core.design.iconBackground']);

const MULTILINE_KEYS = new Set([
	'core.mail.signature',
	'core.mail.footerText',
	'core.ai.style.notes'
]);

/** Mehrzeilig: bekannte Textfelder oder Texte mit Zeilenumbruch (z. B. Mail-Vorlagen aus Modulen). */
function isMultiline(key: string, value: unknown): boolean {
	if (MULTILINE_KEYS.has(key)) return true;
	const d = getDefinition(key).default;
	return [value, d].some((v) => typeof v === 'string' && v.includes('\n'));
}

function kindOf(key: string): FieldKind {
	if (SELECT_OPTIONS[key]) return 'select';
	if (COLOR_KEYS.has(key)) return 'color';
	const d = getDefinition(key).default;
	if (typeof d === 'boolean') return 'boolean';
	if (typeof d === 'number') return 'number';
	if (Array.isArray(d)) return 'list';
	if (d !== null && typeof d === 'object') return 'json';
	return 'text';
}

/** Felder einer oder mehrerer Einstellungsgruppen für die Oberfläche (Secrets ohne Wert). */
export async function loadFields(
	groups: string[],
	only?: (key: string) => boolean
): Promise<FieldDescriptor[]> {
	const out: FieldDescriptor[] = [];
	for (const group of groups) {
		for (const s of await getPublicSettings({ group, scope: 'global' })) {
			if (only && !only(s.key)) continue;
			out.push({
				key: s.key,
				label: s.label,
				description: s.description,
				secret: s.secret,
				isSet: s.isSet,
				kind: kindOf(s.key),
				value: s.value,
				options: SELECT_OPTIONS[s.key],
				multiline: isMultiline(s.key, s.value)
			});
		}
	}
	return out;
}

/**
 * Liest ein Formular im Format `f:<key>` / `clear:<key>`, validiert alle Werte vorab und
 * speichert sie anschließend. Leere Secrets behalten den bisherigen Wert.
 */
export async function saveFields(
	locals: App.Locals,
	fd: FormData,
	allowed: (key: string) => boolean
): Promise<ReturnType<typeof fail> | { success: true; message: string }> {
	const updates: [string, unknown][] = [];
	const keys = [...fd.keys()]
		.filter((k) => k.startsWith('f:') || k.startsWith('clear:'))
		.map((k) => k.slice(k.indexOf(':') + 1));
	// Checkboxen sind nur bei "an" im Formular -> über Marker `has:<key>` erkennen
	for (const k of [...fd.keys()].filter((k) => k.startsWith('has:'))) keys.push(k.slice(4));

	for (const key of new Set(keys)) {
		if (!allowed(key)) return fail(403, { message: `Einstellung nicht erlaubt: ${key}` });
		let def;
		try {
			def = getDefinition(key);
		} catch {
			return fail(400, { message: `Unbekannte Einstellung: ${key}` });
		}
		if (def.scope !== 'global') continue;
		if (def.secret && fd.get(`clear:${key}`) === 'on') {
			updates.push([key, null]);
			continue;
		}
		const raw = fd.get(`f:${key}`);
		const kind = kindOf(key);
		let value: unknown;
		if (kind === 'boolean') {
			value = raw === 'on' || raw === 'true';
		} else if (def.secret && (raw === null || raw === '')) {
			continue;
		} else if (kind === 'number') {
			if (raw === null || String(raw).trim() === '') continue;
			value = Number(raw);
		} else if (kind === 'list') {
			value = String(raw ?? '')
				.split(/[\n,]/)
				.map((s) => s.trim())
				.filter(Boolean);
		} else if (kind === 'json') {
			try {
				value = JSON.parse(String(raw ?? '{}') || '{}');
			} catch {
				return fail(422, { message: `${def.label}: ungültiges JSON` });
			}
		} else {
			value = String(raw ?? '');
		}
		const parsed = def.schema.safeParse(value);
		if (!parsed.success) {
			return fail(422, {
				message: `${def.label}: ${parsed.error.issues.map((i) => i.message).join('; ')}`
			});
		}
		updates.push([key, value]);
	}

	let cleared: string[];
	try {
		// Atomar: alles oder nichts; geänderte Ziele (Host, URL …) verwerfen gespeicherte Secrets
		({ clearedSecrets: cleared } = await setSettings(locals.ctx, Object.fromEntries(updates)));
	} catch (e) {
		if (isCoreError(e)) return fail(e.status, { message: e.message });
		throw e;
	}
	if (cleared.length) {
		const labels = cleared.map((k) => getDefinition(k).label).join(', ');
		return {
			success: true,
			message: `Einstellungen gespeichert. Weil sich das Ziel geändert hat, wurde Folgendes verworfen – bitte neu eingeben: ${labels}`
		};
	}
	return { success: true, message: 'Einstellungen gespeichert' };
}
