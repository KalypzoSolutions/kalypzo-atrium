import { describe, expect, it } from 'vitest';
import { renderBlocks } from '$lib/server/core/pdf/templates';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('PDF-Block box', () => {
	it('rendert Bild links und Text rechts, ohne Rahmen, alles escaped', () => {
		const html = renderBlocks([
			{
				type: 'box',
				image: { dataUrl: PNG, widthMm: 36, alt: 'QR <x>' },
				label: 'Ihr Code',
				value: '123 456',
				lines: ['gültig bis <morgen>'],
				linkLabel: 'Adresse',
				link: { href: 'https://example.test/p/a?x=1&y=2', text: 'example.test/p/a' }
			}
		]);
		expect(html).toContain('class="pdf-box"');
		expect(html).not.toContain('border-radius');
		expect(html).not.toContain('monospace');
		expect(html).toContain(`src="${PNG}"`);
		expect(html).toContain('>123 456<');
		expect(html).toContain('gültig bis &lt;morgen&gt;');
		expect(html).toContain('alt="QR &lt;x&gt;"');
		// Link und Bild sind anklickbar
		expect(html.match(/<a href="https:\/\/example\.test\/p\/a\?x=1&amp;y=2"/g)).toHaveLength(2);
		expect(html).toContain('>example.test/p/a</a>');
		expect(html.indexOf('<img')).toBeLessThan(html.indexOf('Ihr Code'));
	});

	it('ohne Bild nur die Textspalte', () => {
		const html = renderBlocks([{ type: 'box', value: '1' }]);
		expect(html).not.toContain('<img');
		expect(html.match(/<td/g)).toHaveLength(1);
	});

	it('lehnt ungültige Bilder, Breiten und Links ab', () => {
		expect(() =>
			renderBlocks([{ type: 'box', image: { dataUrl: 'https://x.test/a.png', widthMm: 30 } }])
		).toThrow(/Bild/);
		expect(() => renderBlocks([{ type: 'box', image: { dataUrl: PNG, widthMm: 200 } }])).toThrow(
			/Bildbreite/
		);
		expect(() => renderBlocks([{ type: 'box', link: { href: 'javascript:alert(1)' } }])).toThrow(
			/Link/
		);
	});
});

describe('Links in Absätzen und Listen', () => {
	it('macht http(s)-Adressen anklickbar, Satzzeichen bleiben draußen', () => {
		const html = renderBlocks([
			{ type: 'paragraph', text: 'Siehe https://example.test/datenschutz. Danke' },
			{ type: 'list', items: ['Link (http://a.test/x?a=1&b=2), sonst nichts'] }
		]);
		expect(html).toContain(
			'<a href="https://example.test/datenschutz" style="color:inherit;">https://example.test/datenschutz</a>. Danke'
		);
		expect(html).toContain('<a href="http://a.test/x?a=1&amp;b=2"');
		expect(html).toContain('</a>), sonst nichts');
	});

	it('kein Link aus Nicht-URLs oder eingeschleustem HTML', () => {
		const html = renderBlocks([{ type: 'paragraph', text: 'javascript:x <a href="y">z</a>' }]);
		expect(html).not.toContain('<a ');
		expect(html).toContain('&lt;a href=&quot;y&quot;&gt;');
	});
});
