import { describe, expect, it } from 'vitest';
import {
	acceptForContentTypes,
	canonicalContentType,
	DEFAULT_ALLOWED_CONTENT_TYPES,
	EXTENSION_CONTENT_TYPES,
	resolveContentType
} from '$lib/sdk/content-types';
import { assertContentMatches, detectContentType } from '$lib/sdk/server/file-response';
import { checkUploadBytes } from '$lib/sdk/server/upload';

const enc = (s: string) => new TextEncoder().encode(s);
const PSD = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 1, 0, 0]);
const PDF = enc('%PDF-1.6\n…');
const PS = enc('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10');
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const AFFINITY = new Uint8Array([0x00, 0xff, 0x4b, 0x41, 0x10, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const HTML = enc('<!DOCTYPE html><script>alert(1)</script>');

describe('Allowlist und Endungen', () => {
	it('jede Endung zeigt auf einen erlaubten Typ', () => {
		for (const [ext, type] of Object.entries(EXTENSION_CONTENT_TYPES)) {
			expect(DEFAULT_ALLOWED_CONTENT_TYPES, ext).toContain(type);
		}
	});

	it('enthält Archive, Adobe- und Affinity-Formate', () => {
		for (const ext of ['zip', '7z', 'rar', 'tar', 'gz', 'psd', 'ai', 'eps', 'indd', 'idml', 'xd']) {
			expect(EXTENSION_CONTENT_TYPES[ext], ext).toBeTruthy();
		}
		for (const ext of ['afdesign', 'afphoto', 'afpub', 'af', 'aftemplate']) {
			expect(EXTENSION_CONTENT_TYPES[ext], ext).toBeTruthy();
		}
	});
});

describe('Videos und Bilder', () => {
	it('erlaubt MP4, MOV, WebM sowie PNG/JPEG/GIF/WebP/AVIF', () => {
		for (const t of [
			'video/mp4',
			'video/quicktime',
			'video/webm',
			'image/png',
			'image/jpeg',
			'image/gif',
			'image/webp',
			'image/avif'
		]) {
			expect(DEFAULT_ALLOWED_CONTENT_TYPES, t).toContain(t);
		}
		expect(resolveContentType('clip.mov', '')).toBe('video/quicktime');
		expect(resolveContentType('clip.m4v', 'application/octet-stream')).toBe('video/mp4');
	});

	it('MP4-Inhalt passt zu video/mp4, PNG nicht', () => {
		const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
		expect(() => assertContentMatches(mp4, 'video/mp4')).not.toThrow();
		expect(() => assertContentMatches(PNG, 'video/mp4')).toThrow();
	});
});

describe('resolveContentType', () => {
	it('vereinheitlicht Aliasse (Windows-ZIP, RAR, Photoshop)', () => {
		expect(canonicalContentType('application/x-zip-compressed')).toBe('application/zip');
		expect(canonicalContentType('Application/X-RAR-Compressed; x=1')).toBe('application/vnd.rar');
		expect(resolveContentType('bild.psd', 'image/x-photoshop')).toBe('image/vnd.adobe.photoshop');
	});

	it('nimmt bei Archiven und Grafikformaten die Endung', () => {
		expect(resolveContentType('logo.ai', 'application/postscript')).toBe('application/illustrator');
		expect(resolveContentType('daten.zip', 'application/x-compressed')).toBe('application/zip');
		expect(resolveContentType('plakat.afdesign', '')).toBe('application/x-affinity-designer');
		expect(resolveContentType('plakat.afpub', 'application/octet-stream')).toBe(
			'application/x-affinity-publisher'
		);
	});

	it('behält sonst den gemeldeten Typ', () => {
		expect(resolveContentType('brief.pdf', 'application/pdf')).toBe('application/pdf');
		expect(resolveContentType('seite.txt', 'text/html')).toBe('text/html');
		expect(resolveContentType('programm.exe', '')).toBe('');
	});
});

describe('acceptForContentTypes', () => {
	it('ergänzt Endungen und lässt Platzhalter offen', () => {
		const accept = acceptForContentTypes(['application/x-affinity-designer', 'image/*'])!;
		expect(accept.split(',')).toEqual(expect.arrayContaining(['.afdesign', '.png', '.psd']));
		expect(acceptForContentTypes(['*/*'])).toBeUndefined();
		expect(acceptForContentTypes([])).toBeUndefined();
	});
});

describe('Inhaltsprüfung für Grafikformate', () => {
	it('erkennt Photoshop', () => {
		expect(detectContentType(PSD)).toBe('image/vnd.adobe.photoshop');
		expect(() => assertContentMatches(PSD, 'image/vnd.adobe.photoshop')).not.toThrow();
		expect(() => assertContentMatches(PNG, 'image/vnd.adobe.photoshop')).toThrow();
	});

	it('Illustrator darf PDF oder PostScript sein, aber kein HTML', () => {
		expect(() => assertContentMatches(PDF, 'application/illustrator')).not.toThrow();
		expect(() => assertContentMatches(PS, 'application/illustrator')).not.toThrow();
		expect(() => assertContentMatches(PS, 'application/postscript')).not.toThrow();
		expect(() => assertContentMatches(HTML, 'application/illustrator')).toThrow();
		expect(() => assertContentMatches(HTML, 'application/postscript')).toThrow();
		expect(() => assertContentMatches(PNG, 'application/illustrator')).toThrow();
	});

	it('IDML/XD müssen ZIP sein, Affinity nicht als HTML getarnt', () => {
		expect(() =>
			assertContentMatches(ZIP, 'application/vnd.adobe.indesign-idml-package')
		).not.toThrow();
		expect(() => assertContentMatches(PSD, 'application/vnd.adobe.xd')).toThrow();
		expect(() => assertContentMatches(AFFINITY, 'application/x-affinity-designer')).not.toThrow();
		expect(() => assertContentMatches(HTML, 'application/x-affinity-designer')).toThrow();
		expect(() => assertContentMatches(PDF, 'application/x-affinity-photo')).toThrow();
	});

	it('checkUploadBytes nimmt ZIP mit Windows-Typ an', () => {
		const file = checkUploadBytes(
			{ bytes: ZIP, contentType: 'application/x-zip-compressed', name: 'a.zip' },
			{ maxBytes: 100, allowedTypes: DEFAULT_ALLOWED_CONTENT_TYPES }
		);
		expect(file.contentType).toBe('application/zip');
	});
});
