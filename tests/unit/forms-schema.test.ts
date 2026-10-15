import { describe, expect, it } from 'vitest';
import {
	buildFormSchema,
	emptyValues,
	formDefinitionSchema,
	getFieldType,
	slugKey,
	validateFormValues,
	visibleFields,
	type FieldDefinition,
	type FormDefinition
} from '$lib/forms';

function def(...fields: FieldDefinition[]): FormDefinition {
	return { version: 1, fields };
}
function f(field: Record<string, unknown>): FieldDefinition {
	return { id: field.key, label: 'Feld', ...field } as unknown as FieldDefinition;
}
function ok(d: FormDefinition, raw: unknown) {
	const r = validateFormValues(d, raw);
	if (!r.ok) throw new Error(JSON.stringify(r.errors));
	return r.values;
}
function errs(d: FormDefinition, raw: unknown) {
	const r = validateFormValues(d, raw);
	if (r.ok) throw new Error('erwartet: Fehler');
	return r.errors;
}

describe('Feldtypen', () => {
	it('text: trimmt, Grenzen, Steuerzeichen', () => {
		const d = def(f({ key: 'a', type: 'text', maxLength: 5 }));
		expect(ok(d, { a: '  abc ' })).toEqual({ a: 'abc' });
		expect(errs(d, { a: 'abcdef' }).a).toContain('Höchstens 5');
		expect(errs(d, { a: 'a\u0000b' }).a).toBeTruthy();
		expect(errs(d, { a: 'a\nb' }).a).toBeTruthy();
		expect(errs(d, { a: 5 }).a).toBeTruthy();
		const long = def(f({ key: 'a', type: 'text' }));
		expect(ok(long, { a: 'x'.repeat(200) }).a).toHaveLength(200);
		expect(errs(long, { a: 'x'.repeat(201) }).a).toBeTruthy();
		const cap = def(f({ key: 'a', type: 'text', maxLength: 99999 }));
		expect(errs(cap, { a: 'x'.repeat(2001) }).a).toBeTruthy();
	});

	it('textarea: Zeilenumbrüche, Standard 2000', () => {
		const d = def(f({ key: 'a', type: 'textarea' }));
		expect(ok(d, { a: 'eins\nzwei' })).toEqual({ a: 'eins\nzwei' });
		expect(errs(d, { a: 'x'.repeat(2001) }).a).toBeTruthy();
		expect(errs(d, { a: 'a\u0007' }).a).toBeTruthy();
	});

	it('number: String wird gewandelt, min/max/integer', () => {
		const d = def(f({ key: 'n', type: 'number', min: 1, max: 10, integer: true }));
		expect(ok(d, { n: '5' })).toEqual({ n: 5 });
		expect(ok(d, { n: 10 })).toEqual({ n: 10 });
		expect(errs(d, { n: 0 }).n).toContain('Mindestens');
		expect(errs(d, { n: 11 }).n).toContain('Höchstens');
		expect(errs(d, { n: 2.5 }).n).toContain('ganze');
		expect(errs(d, { n: 'abc' }).n).toBeTruthy();
		expect(errs(d, { n: Infinity }).n).toBeTruthy();
		expect(errs(d, { n: NaN }).n).toBeTruthy();
	});

	it('email: klein, getrimmt, ungültig', () => {
		const d = def(f({ key: 'e', type: 'email' }));
		expect(ok(d, { e: '  Max@Example.DE ' })).toEqual({ e: 'max@example.de' });
		expect(errs(d, { e: 'kein-mail' }).e).toBeTruthy();
		expect(errs(d, { e: 'a'.repeat(200) + '@example.de' }).e).toBeTruthy();
	});

	it('phone: Format und Ziffernanzahl', () => {
		const d = def(f({ key: 't', type: 'phone' }));
		expect(ok(d, { t: ' +49  421   123456 ' })).toEqual({ t: '+49 421 123456' });
		expect(errs(d, { t: 'abc' }).t).toBeTruthy();
		expect(errs(d, { t: '12345' }).t).toBeTruthy();
		expect(errs(d, { t: '+1234567890123456' }).t).toBeTruthy();
	});

	it('date: echtes Kalenderdatum, min/max', () => {
		const d = def(f({ key: 'd', type: 'date', min: '2020-01-01', max: '2030-12-31' }));
		expect(ok(d, { d: '2024-02-29' })).toEqual({ d: '2024-02-29' });
		expect(errs(d, { d: '2023-02-29' }).d).toBeTruthy();
		expect(errs(d, { d: '2024-13-01' }).d).toBeTruthy();
		expect(errs(d, { d: '01.02.2024' }).d).toBeTruthy();
		expect(errs(d, { d: '2019-12-31' }).d).toContain('Frühestens');
		expect(errs(d, { d: '2031-01-01' }).d).toContain('Spätestens');
		expect(ok(d, { d: '2020-01-01' }).d).toBe('2020-01-01');
	});

	it('select: Whitelist und allowOther', () => {
		const options = [
			{ value: 'a', label: 'A' },
			{ value: 'b', label: 'B' }
		];
		const d = def(f({ key: 's', type: 'select', options }));
		expect(ok(d, { s: 'a' })).toEqual({ s: 'a' });
		expect(errs(d, { s: 'c' }).s).toBeTruthy();
		const o = def(f({ key: 's', type: 'select', options, allowOther: true }));
		expect(ok(o, { s: 'Etwas anderes' })).toEqual({ s: 'Etwas anderes' });
		expect(errs(o, { s: 'x'.repeat(101) }).s).toBeTruthy();
	});

	it('multiselect: eindeutig, Whitelist, min/max', () => {
		const options = ['a', 'b', 'c'].map((v) => ({ value: v, label: v.toUpperCase() }));
		const d = def(f({ key: 'm', type: 'multiselect', options, min: 2, max: 2 }));
		expect(ok(d, { m: ['a', 'b'] })).toEqual({ m: ['a', 'b'] });
		expect(errs(d, { m: ['a'] }).m).toContain('mindestens');
		expect(errs(d, { m: ['a', 'b', 'c'] }).m).toContain('höchstens');
		expect(errs(d, { m: ['a', 'a'] }).m).toBeTruthy();
		expect(errs(d, { m: ['a', 'x'] }).m).toBeTruthy();
		expect(errs(d, { m: 'a' }).m).toBeTruthy();
	});

	it('boolean und consent', () => {
		const d = def(
			f({ key: 'b', type: 'boolean' }),
			f({ key: 'c', type: 'consent', text: 'ok', required: true })
		);
		expect(ok(d, { b: false, c: true })).toEqual({ b: false, c: true });
		expect(errs(d, { b: 'ja', c: true }).b).toBeTruthy();
		expect(errs(d, { b: true, c: false }).c).toBe('Bitte bestätigen');
		expect(errs(d, { b: true }).c).toBe('Bitte bestätigen');
		const req = def(f({ key: 'b', type: 'boolean', required: true }));
		expect(errs(req, { b: false }).b).toBe('Bitte bestätigen');
		expect(ok(req, { b: true })).toEqual({ b: true });
	});

	it('info: kein Wert, Schlüssel unbekannt/verworfen', () => {
		const d = def(f({ key: 'i', type: 'info', text: 'Hallo' }), f({ key: 'a', type: 'text' }));
		expect(ok(d, { a: 'x' })).toEqual({ a: 'x' });
		expect(ok(d, { a: 'x', i: 'egal' })).toEqual({ a: 'x' });
		expect(visibleFields(d).map((x) => x.key)).toEqual(['a']);
		expect(Object.keys(emptyValues(d))).toEqual(['a']);
	});
});

describe('Pflicht und Gesamtvalidierung', () => {
	it('optional und leer → null, Pflicht und leer → Pflichtfeld', () => {
		const d = def(
			f({ key: 'a', type: 'text' }),
			f({ key: 'b', type: 'text', required: true }),
			f({ key: 'm', type: 'multiselect', options: [{ value: 'x', label: 'X' }] }),
			f({ key: 'n', type: 'number' })
		);
		expect(ok(d, { a: '', b: 'x', m: [], n: '' })).toEqual({ a: null, b: 'x', m: null, n: null });
		expect(ok(d, { b: 'x' })).toEqual({ a: null, b: 'x', m: null, n: null });
		expect(errs(d, { a: '', b: '   ', m: [], n: null }).b).toBe('Pflichtfeld');
		expect(errs(d, {}).b).toBe('Pflichtfeld');
	});

	it('unbekannte Schlüssel und Nicht-Objekt', () => {
		const d = def(f({ key: 'a', type: 'text' }));
		expect(errs(d, { a: 'x', zzz: 1 }).zzz).toBe('Unbekanntes Feld');
		expect(errs(d, 'text')._form).toBeTruthy();
		expect(errs(d, null)._form).toBeTruthy();
		expect(errs(d, [])._form).toBeTruthy();
	});

	it('hidden-Felder werden still verworfen', () => {
		const d = def(
			f({ key: 'a', type: 'text' }),
			f({ key: 'h', type: 'text', hidden: true, required: true })
		);
		expect(ok(d, { a: 'x', h: 'geheim' })).toEqual({ a: 'x' });
		expect(ok(d, { a: 'x' })).toEqual({ a: 'x' });
	});

	it('buildFormSchema ist ein Zod-Schema', () => {
		const d = def(f({ key: 'a', type: 'text' }));
		expect(buildFormSchema(d).safeParse({ a: 'x' }).success).toBe(true);
		expect(buildFormSchema(d).safeParse({ a: 'x', b: 1 }).success).toBe(false);
	});

	it('emptyValues', () => {
		const d = def(
			f({ key: 't', type: 'text' }),
			f({ key: 'n', type: 'number' }),
			f({ key: 'b', type: 'boolean' }),
			f({ key: 'c', type: 'consent', text: '' }),
			f({ key: 'm', type: 'multiselect', options: [{ value: 'x', label: 'X' }] })
		);
		expect(emptyValues(d)).toEqual({ t: '', n: '', b: false, c: false, m: [] });
	});
});

describe('formDefinitionSchema', () => {
	const valid: FormDefinition = {
		version: 1,
		title: 'Anmeldung',
		fields: [
			{ id: 'f1', key: 'name', type: 'text', label: 'Name', required: true },
			{
				id: 'f2',
				key: 'wahl',
				type: 'select',
				label: 'Wahl',
				options: [
					{ value: 'a', label: 'A' },
					{ value: 'b', label: 'B' }
				]
			},
			{ id: 'f3', key: 'dsgvo', type: 'consent', label: 'DS', text: 'ok', href: 'https://x.de/ds' }
		]
	};

	it('akzeptiert gültige Definition (Rundlauf JSON → parse → validate)', () => {
		const parsed = formDefinitionSchema.parse(JSON.parse(JSON.stringify(valid)));
		expect(parsed).toEqual(valid);
		expect(ok(parsed, { name: 'Max', wahl: 'a', dsgvo: true })).toEqual({
			name: 'Max',
			wahl: 'a',
			dsgvo: true
		});
	});

	it('lehnt Fehler ab', () => {
		const bad = (fields: unknown[], extra: object = {}) =>
			formDefinitionSchema.safeParse({ version: 1, fields, ...extra }).success;
		const t = (id: string, key: string) => ({ id, key, type: 'text', label: 'L' });
		expect(bad([t('1', 'a'), t('2', 'a')])).toBe(false);
		expect(bad([t('1', 'a'), t('1', 'b')])).toBe(false);
		expect(bad([t('1', '1abc')])).toBe(false);
		expect(bad([t('1', 'a'.repeat(41))])).toBe(false);
		expect(bad(Array.from({ length: 61 }, (_, i) => t(String(i), 'k' + i)))).toBe(false);
		expect(bad(Array.from({ length: 60 }, (_, i) => t(String(i), 'k' + i)))).toBe(true);
		expect(bad([{ ...t('1', 'a'), label: '' }])).toBe(false);
		expect(bad([{ ...t('1', 'a'), maxLength: 0 }])).toBe(false);
		expect(bad([{ ...t('1', 'a'), type: 'unbekannt' }])).toBe(false);
		expect(bad([{ ...t('1', 'a'), type: 'number', min: 5, max: 1 }])).toBe(false);
		expect(bad([{ ...t('1', 'a'), type: 'select', options: [] }])).toBe(false);
		expect(
			bad([
				{
					...t('1', 'a'),
					type: 'select',
					options: [
						{ value: 'x', label: 'A' },
						{ value: 'x', label: 'B' }
					]
				}
			])
		).toBe(false);
		expect(bad([{ ...t('1', 'a'), type: 'consent', text: 't', href: 'javascript:alert(1)' }])).toBe(
			false
		);
		expect(bad([{ ...t('1', 'a'), type: 'consent', text: 't', href: 'nicht-url' }])).toBe(false);
		expect(bad([t('1', 'a')], { title: 'x'.repeat(121) })).toBe(false);
		expect(bad([t('1', 'a')], { submitLabel: 'x'.repeat(61) })).toBe(false);
		expect(formDefinitionSchema.safeParse({ version: 2, fields: [] }).success).toBe(false);
	});

	it('create() aller Feldtypen ist gültig', () => {
		const fields = [
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
		].map((type, i) => getFieldType(type).create('id' + i, 'k' + i));
		expect(formDefinitionSchema.safeParse({ version: 1, fields }).success).toBe(true);
	});
});

describe('slugKey', () => {
	it.each([
		['Wohnort Bremen', 'wohnortBremen'],
		['Größe & Gewicht', 'groesseGewicht'],
		['Straße', 'strasse'],
		['Café Ärger', 'cafeAerger'],
		['123 Test', 'field123Test'],
		['', 'field'],
		['!!!', 'field'],
		['a'.repeat(60), 'a'.repeat(40)]
	])('%s → %s', (input, expected) => {
		expect(slugKey(input)).toBe(expected);
	});
});
