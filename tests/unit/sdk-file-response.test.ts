import { describe, expect, it } from 'vitest';
import {
	assertContentMatches,
	contentDisposition,
	detectContentType,
	secureFileResponse
} from '$lib/sdk/server/file-response';

// #67 (01b-11): gemeinsamer, gehärteter Datei-Auslieferer und Magic-Bytes-Prüfung für Module.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PDF = new TextEncoder().encode('%PDF-1.7\n…');
const HTML = new TextEncoder().encode('  <!DOCTYPE html><script>alert(1)</script>');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe('secureFileResponse', () => {
	it('setzt CSP-Sandbox, nosniff und RFC-5987-Dateinamen', () => {
		const res = secureFileResponse(PDF, {
			contentType: 'application/pdf',
			size: PDF.byteLength,
			name: 'Beleg März "x".pdf'
		});
		expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('content-type')).toBe('application/pdf');
		expect(res.headers.get('content-length')).toBe(String(PDF.byteLength));
		const cd = res.headers.get('content-disposition')!;
		expect(cd).toMatch(
			/^inline; filename="Beleg Marz x.pdf"; filename\*=UTF-8''Beleg%20M%C3%A4rz%20x\.pdf$/
		);
		expect(res.headers.get('cache-control')).toBe('private, max-age=60');
	});

	it('aktive Inhalte nie inline, sondern als octet-stream attachment', () => {
		for (const ct of [
			'text/html',
			'image/svg+xml',
			'application/xhtml+xml',
			'text/html; charset=utf-8'
		]) {
			const res = secureFileResponse(HTML, { contentType: ct, name: 'a.html' });
			expect(res.headers.get('content-type')).toBe('application/octet-stream');
			expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
			expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
		}
	});

	it('Download erzwingt attachment; Text als text/plain mit charset', () => {
		expect(
			secureFileResponse(PNG, { contentType: 'image/png', download: true }).headers.get(
				'content-disposition'
			)
		).toMatch(/^attachment;/);
		expect(secureFileResponse(PNG, { contentType: 'text/plain' }).headers.get('content-type')).toBe(
			'text/plain; charset=utf-8'
		);
		expect(
			secureFileResponse(ZIP, { contentType: 'application/zip' }).headers.get('content-disposition')
		).toMatch(/^attachment;/);
	});

	it('Dateiname ohne Steuerzeichen/Anführungszeichen', () => {
		expect(contentDisposition('inline', 'a\r\nb".png')).toBe(
			`inline; filename="ab.png"; filename*=UTF-8''ab.png`
		);
		expect(contentDisposition('attachment', '')).toMatch(/filename="datei"/);
	});
});

describe('Magic Bytes', () => {
	it('erkennt gängige Typen', () => {
		expect(detectContentType(PNG)).toBe('image/png');
		expect(detectContentType(JPEG)).toBe('image/jpeg');
		expect(detectContentType(PDF)).toBe('application/pdf');
		expect(detectContentType(WEBP)).toBe('image/webp');
		expect(detectContentType(ZIP)).toBe('application/zip');
		expect(detectContentType(HTML)).toBeNull();
	});

	it('Upload mit falschem Inhalt → 422', () => {
		expect(() => assertContentMatches(HTML, 'application/pdf')).toThrow(
			expect.objectContaining({ code: 'validation_failed' })
		);
		expect(() => assertContentMatches(PDF, 'image/png')).toThrow(
			expect.objectContaining({ code: 'validation_failed' })
		);
		expect(() => assertContentMatches(SVG, 'text/plain')).toThrow(
			expect.objectContaining({ code: 'validation_failed' })
		);
		expect(() => assertContentMatches(PNG, 'text/csv')).toThrow(
			expect.objectContaining({ code: 'validation_failed' })
		);
		expect(() =>
			assertContentMatches(
				PNG,
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
			)
		).toThrow(expect.objectContaining({ code: 'validation_failed' }));
	});

	it('passender Inhalt wird angenommen', () => {
		expect(() => assertContentMatches(PDF, 'application/pdf')).not.toThrow();
		expect(() => assertContentMatches(JPEG, 'image/jpeg')).not.toThrow();
		expect(() =>
			assertContentMatches(ZIP, 'application/vnd.oasis.opendocument.text')
		).not.toThrow();
		expect(() =>
			assertContentMatches(new TextEncoder().encode('Name;Betrag\nA;1'), 'text/csv')
		).not.toThrow();
	});
});
