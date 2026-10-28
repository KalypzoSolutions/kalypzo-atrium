import { describe, expect, it } from 'vitest';
import {
	buildFormSchema,
	displayFields,
	emptyValues,
	formDefinitionSchema,
	getFieldType,
	parseRichText,
	plainToRichText,
	richTextToPlain,
	safeHref,
	visibleFields,
	type FormDefinition,
	type RichNode
} from '$lib/forms';

/** Alle Tags im Baum (zum Prüfen der Allowlist) */
function tags(nodes: RichNode[]): string[] {
	return nodes.flatMap((n) => (n.type === 'element' ? [n.tag, ...tags(n.children)] : []));
}

describe('parseRichText', () => {
	it('übernimmt erlaubte Formatierungen', () => {
		const nodes = parseRichText('<p>Hallo <strong>Welt</strong></p><ul><li>a</li><li>b</li></ul>');
		expect(tags(nodes)).toEqual(['p', 'strong', 'ul', 'li', 'li']);
		expect(richTextToPlain('<p>Hallo <strong>Welt</strong></p>')).toBe('Hallo Welt');
	});

	it('verwirft Skripte, Styles und Event-Handler', () => {
		const nodes = parseRichText(
			'<p onclick="alert(1)">x</p><script>alert(1)</script><style>p{}</style><img src=x onerror=alert(1)>'
		);
		expect(tags(nodes)).toEqual(['p']);
		expect(JSON.stringify(nodes)).not.toContain('alert');
		expect(JSON.stringify(nodes)).not.toContain('onclick');
	});

	it('unbekannte Container entfallen, ihr Text bleibt', () => {
		const nodes = parseRichText('<div><span>Text</span></div><iframe src="x">weg</iframe>');
		expect(tags(nodes)).toEqual([]);
		expect(richTextToPlain('<div><span>Text</span></div><iframe>weg</iframe>')).toBe('Text');
	});

	it('Links nur mit http(s)/mailto', () => {
		const [a] = parseRichText('<a href="javascript:alert(1)">x</a>');
		expect(a).toMatchObject({ type: 'element', tag: 'a', href: undefined });
		const [b] = parseRichText('<a href="https://example.org/a?b=1&amp;c=2">x</a>');
		expect(b).toMatchObject({ href: 'https://example.org/a?b=1&c=2' });
		expect(safeHref('mailto:info@example.org')).toBe('mailto:info@example.org');
		expect(safeHref('jav&#x61;script:alert(1)')).toBeUndefined();
		expect(safeHref('data:text/html,x')).toBeUndefined();
	});

	it('dekodiert Entitäten als Text (keine HTML-Interpretation)', () => {
		const [p] = parseRichText('<p>&lt;b&gt;fett&lt;/b&gt; &amp; &#228;</p>');
		expect(p).toMatchObject({ children: [{ type: 'text', text: '<b>fett</b> & ä' }] });
	});

	it('übersteht kaputtes HTML', () => {
		expect(() => parseRichText('<p><strong>offen<em>x</p></strong><')).not.toThrow();
		expect(richTextToPlain('<p>a<br>b</p>')).toBe('a\nb');
	});

	it('plainToRichText escaped und bildet Absätze', () => {
		expect(plainToRichText('a <b>\nzwei\n\nneu')).toBe('<p>a &lt;b&gt;<br>zwei</p><p>neu</p>');
	});
});

describe('Anzeige-Typen info und section', () => {
	const def: FormDefinition = {
		version: 1,
		fields: [
			{ id: '1', key: 'abschnitt', type: 'section', label: 'Allgemeines', text: 'Untertitel' },
			{
				id: '2',
				key: 'hinweis',
				type: 'info',
				label: 'Hinweis',
				text: '<p>Info</p>',
				format: 'html'
			},
			{ id: '3', key: 'name', type: 'text', label: 'Name', required: true }
		]
	};

	it('sind gültige Definitionen', () => {
		expect(formDefinitionSchema.safeParse(def).success).toBe(true);
		expect(
			formDefinitionSchema.safeParse({
				version: 1,
				fields: [{ id: '1', key: 'x', type: 'section', label: 'X', text: 'a'.repeat(501) }]
			}).success
		).toBe(false);
	});

	it('haben keinen Wert und werden nicht validiert', () => {
		expect(getFieldType('section').hasValue).toBe(false);
		expect(visibleFields(def).map((f) => f.key)).toEqual(['name']);
		expect(displayFields(def).map((f) => f.key)).toEqual(['abschnitt', 'hinweis', 'name']);
		expect(Object.keys(emptyValues(def))).toEqual(['name']);
		expect(buildFormSchema(def).safeParse({ name: 'Anna' }).success).toBe(true);
	});

	it('neuer Infotext ist formatiert', () => {
		const f = getFieldType('info').create('i', 'k');
		expect(f).toMatchObject({ type: 'info', format: 'html' });
	});
});
