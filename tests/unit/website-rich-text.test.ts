/**
 * Bereinigung von Blog-/FAQ-HTML auf der Stammeswebsite (`website/src/lib/server/rich-text.ts`): erste `{@html}`-Stelle
 * der Website – nur Whitelist, Bilder nur mit bekannter ID über den Bild-Proxy.
 */
import { describe, expect, it } from 'vitest';
import { renderRichText, textToHtml } from '../../website/src/lib/server/rich-text';

const IMG = '0b6f1f5e-3c2a-4d6e-9f1a-2b3c4d5e6f70';
const images = new Map([[IMG, { width: 1600, height: 900 }]]);
const imageUrl = (id: string, variant: 'thumb' | 'web') => `/bilder/blog/lager/${id}/${variant}`;

describe('renderRichText', () => {
	it('lässt einfache Formatierung durch', () => {
		const html =
			'<h2>Titel</h2><p>Ein <strong>fetter</strong> und <em>kursiver</em> Text.</p><ul><li>Eins</li></ul>' +
			'<blockquote>Zitat</blockquote><hr>';
		expect(renderRichText(html)).toBe(
			'<h2>Titel</h2><p>Ein <strong>fetter</strong> und <em>kursiver</em> Text.</p><ul><li>Eins</li></ul>' +
				'<blockquote>Zitat</blockquote><hr />'
		);
	});

	it('entfernt Skripte, Ereignis-Attribute, Stile und Klassen', () => {
		const out = renderRichText(
			'<p onclick="alert(1)" style="color:red" class="x">Hallo</p><script>alert(1)</script>' +
				'<iframe src="https://evil.example"></iframe><style>p{}</style>'
		);
		expect(out).toBe('<p>Hallo</p>');
	});

	it('entfernt javascript:-Links und setzt rel/target', () => {
		expect(renderRichText('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
		expect(renderRichText('<a href=" JaVaScRiPt:alert(1)">x</a>')).not.toContain('javascript');
		expect(renderRichText('<a href="https://example.org" onclick="x()">extern</a>')).toBe(
			'<a href="https://example.org" rel="noopener noreferrer" target="_blank">extern</a>'
		);
		expect(renderRichText('<a href="/termine" target="_self">intern</a>')).toBe(
			'<a href="/termine" rel="noopener noreferrer">intern</a>'
		);
		expect(renderRichText('<a href="mailto:info@example.org">Mail</a>')).toBe(
			'<a href="mailto:info@example.org" rel="noopener noreferrer">Mail</a>'
		);
		expect(renderRichText('<a href="//evil.example/x">x</a>')).toBe('<a>x</a>');
	});

	it('schreibt bekannte Bilder auf den Proxy um (Maße, lazy)', () => {
		const out = renderRichText(
			`<p>Bild:</p><img data-image-id="${IMG}" alt="Zelte am See" src="https://evil.example/a.png" onerror="alert(1)">`,
			{ images, imageUrl }
		);
		expect(out).toBe(
			`<p>Bild:</p><img src="/bilder/blog/lager/${IMG}/web" alt="Zelte am See" width="1600" height="900" ` +
				'loading="lazy" decoding="async" />'
		);
	});

	it('entfernt fremde Bildquellen und unbekannte Bild-IDs', () => {
		expect(
			renderRichText('<p>a</p><img src="https://evil.example/a.png">', { images, imageUrl })
		).toBe('<p>a</p>');
		expect(
			renderRichText('<img data-image-id="11111111-2222-3333-4444-555555555555" alt="x">', {
				images,
				imageUrl
			})
		).toBe('');
		// ohne Bild-Kontext (z. B. FAQ-Antworten) gibt es gar keine Bilder
		expect(renderRichText(`<img data-image-id="${IMG}">`)).toBe('');
	});

	it('ersetzt h1 durch h2 und h4 durch h3', () => {
		expect(renderRichText('<h1>A</h1><h4>B</h4>')).toBe('<h2>A</h2><h3>B</h3>');
	});
});

describe('textToHtml', () => {
	it('maskiert Klartext und bildet Absätze', () => {
		expect(textToHtml('a < b & "c"\n\nZweiter\nAbsatz')).toBe(
			'<p>a &lt; b &amp; &quot;c&quot;</p><p>Zweiter<br>Absatz</p>'
		);
	});
});
