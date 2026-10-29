/**
 * PDF-Block `richText`: Bereinigung über `sanitizeDocumentHtml` (Allowlist) und Ausgabe in `renderBlocks`.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeDocumentHtml } from '$lib/sdk/server/html';
import { MAX_RICH_TEXT_CHARS, renderBlocks } from '$lib/server/core/pdf/templates';

const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

describe('sanitizeDocumentHtml', () => {
	it('entfernt Skripte, Event-Handler und unbekannte Tags', () => {
		const out = sanitizeDocumentHtml(
			'<p onclick="x()">Hallo<script>alert(1)</script></p><iframe src="https://evil.test"></iframe><style>p{}</style>'
		);
		expect(out).toBe('<p>Hallo</p>');
	});

	it('Bilder nur als Data-URL (png/jpeg/webp/gif), externe und onerror entfallen', () => {
		const out = sanitizeDocumentHtml(
			`<img src="${PNG}" alt="ok" onerror="alert(1)"><img src="https://evil.test/a.png" alt="extern"><img src="data:image/svg+xml;base64,PHN2Zz4=" alt="svg"><img src="//evil.test/x.png">`
		);
		expect(out).toContain('alt="ok"');
		expect(out).toContain(PNG);
		expect(out).not.toContain('onerror');
		expect(out).not.toContain('evil.test');
		expect(out).not.toContain('svg');
		expect(out.match(/<img/g)).toHaveLength(1);
	});

	it('zu große Bilder entfallen', () => {
		const big = `data:image/png;base64,${'A'.repeat(10 * 1024 * 1024)}`;
		expect(sanitizeDocumentHtml(`<p>a</p><img src="${big}">`)).toBe('<p>a</p>');
	});

	it('Links nur http/https/mailto, javascript: entfällt', () => {
		const out = sanitizeDocumentHtml(
			'<a href="javascript:alert(1)">böse</a> <a href="https://example.org">gut</a> <a href="mailto:a@b.de">Mail</a>'
		);
		expect(out).not.toContain('javascript');
		expect(out).toContain('href="https://example.org"');
		expect(out).toContain('rel="noopener noreferrer"');
		expect(out).toContain('href="mailto:a@b.de"');
	});

	it('Styles: nur Farbe/Hintergrund/Schriftgröße/Ausrichtung mit gültigen Werten', () => {
		const out = sanitizeDocumentHtml(
			[
				'<p style="text-align:center;position:fixed">A</p>',
				'<span style="color:#ff0000;background-image:url(https://evil.test/x)">B</span>',
				'<span style="color:red;font-size:200px">C</span>',
				'<span style="background-color:url(https://evil.test)">D</span>',
				'<mark style="background-color:rgb(1, 2, 3);font-size:14px">E</mark>',
				'<span style="color:expression(alert(1))">F</span>'
			].join('')
		);
		expect(out).toContain('text-align:center');
		expect(out).not.toContain('position');
		expect(out).toContain('color:#ff0000');
		expect(out).not.toContain('url(');
		expect(out).not.toContain('200px');
		expect(out).not.toContain('color:red');
		expect(out).toContain('background-color:rgb(1, 2, 3)');
		expect(out).toContain('font-size:14px');
		expect(out).not.toContain('expression');
	});

	it('Tabellen mit colspan/rowspan, ungültige Werte entfallen', () => {
		const out = sanitizeDocumentHtml(
			'<table><tbody><tr><td colspan="2" rowspan="x">a</td><th rowspan="3">b</th></tr></tbody></table>'
		);
		expect(out).toContain('colspan="2"');
		expect(out).not.toContain('rowspan="x"');
		expect(out).toContain('rowspan="3"');
	});

	it('Aufgaben: Checkbox immer gesperrt, andere input-Typen werden zur Checkbox', () => {
		const out = sanitizeDocumentHtml(
			'<ul class="task-list evil"><li class="task-item checked"><input type="text" value="x" checked><div>Erledigt</div></li></ul>'
		);
		expect(out).toContain('<ul class="task-list">');
		expect(out).toContain('class="task-item checked"');
		expect(out).toContain('type="checkbox"');
		expect(out).toContain('disabled');
		expect(out).toContain('checked');
		expect(out).not.toContain('value=');
		expect(out).not.toContain('evil');
	});
});

describe('renderBlocks: richText', () => {
	it('bereinigt den Block und gibt das Druck-CSS einmal aus', () => {
		const html = renderBlocks([
			{ type: 'richText', html: '<h1>Titel</h1><p>Text<script>x</script></p>' },
			{ type: 'richText', html: '<pre><code>a &lt; b</code></pre>' }
		]);
		expect(html.match(/<style>/g)).toHaveLength(1);
		expect(html).toContain('<div class="rich-text"><h1>Titel</h1><p>Text</p></div>');
		expect(html).toContain('<pre><code>a &lt; b</code></pre>');
		expect(html).not.toContain('<script>');
	});

	it('Gesamtgröße über 40 MB → 413', () => {
		const half = 'a'.repeat(MAX_RICH_TEXT_CHARS / 2 + 1);
		expect(() =>
			renderBlocks([
				{ type: 'richText', html: half },
				{ type: 'richText', html: half }
			])
		).toThrow(expect.objectContaining({ status: 413 }));
	});
});
