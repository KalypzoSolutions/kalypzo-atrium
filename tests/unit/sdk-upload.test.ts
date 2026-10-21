import { describe, expect, it } from 'vitest';
import {
	checkUploadBytes,
	readUpload,
	safeFileName,
	takeUpload,
	type UploadRules
} from '$lib/sdk/server/upload';
import { contentDisposition } from '$lib/sdk/server/file-response';
import { isCoreError } from '$lib/server/core/errors';

const PDF = new TextEncoder().encode('%PDF-1.7\n…');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const RULES = {
	maxBytes: 1024,
	allowedTypes: ['application/pdf', 'image/png'],
	typesLabel: 'PDF oder PNG'
} satisfies UploadRules;

function req(form: FormData | string, headers: Record<string, string> = {}): Request {
	return new Request('http://x.test/upload', {
		method: 'POST',
		body: form,
		headers: typeof form === 'string' ? { 'content-type': 'text/plain', ...headers } : headers
	});
}
const formWith = (bytes: Uint8Array | string, name: string, type: string, field = 'file') => {
	const f = new FormData();
	f.set(field, new File([bytes as BlobPart], name, { type }));
	return f;
};

async function failure(
	p: Promise<unknown>
): Promise<{ status: number; code: string; details: unknown }> {
	try {
		await p;
	} catch (e) {
		if (isCoreError(e)) return { status: e.status, code: e.code, details: e.details };
		throw e;
	}
	throw new Error('kein Fehler');
}

describe('readUpload (#33)', () => {
	it('liest gültige Datei mit geprüftem Typ und Namen', async () => {
		const f = await readUpload(
			req(formWith(PDF, ' Beleg Müller.pdf ', 'application/pdf; x=1')),
			RULES
		);
		expect(f.contentType).toBe('application/pdf');
		expect(f.name).toBe('Beleg Müller.pdf');
		expect(f.size).toBe(PDF.byteLength);
		expect(f.bytes).toEqual(PDF);
	});
	it('fehlendes Feld, leere Datei, falscher Typ → 422 mit Pfad', async () => {
		const missing = await failure(readUpload(req(new FormData()), RULES));
		expect(missing).toMatchObject({ status: 422, code: 'validation_failed' });
		expect(missing.details).toEqual([{ path: ['file'], message: 'Bitte eine Datei auswählen' }]);
		const empty = await failure(readUpload(req(formWith('', 'a.pdf', 'application/pdf')), RULES));
		expect(empty.details).toEqual([{ path: ['file'], message: 'Die Datei ist leer' }]);
		const type = await failure(readUpload(req(formWith('x', 'a.txt', 'text/plain')), RULES));
		expect(type.status).toBe(422);
		expect(type.details).toEqual([
			{ path: ['file'], message: 'Dateityp nicht erlaubt (PDF oder PNG)' }
		]);
	});
	it('Inhalt passt nicht zum Typ (HTML als PDF, PNG als PDF) → 422', async () => {
		for (const body of ['<html><script>', PNG]) {
			const r = await failure(readUpload(req(formWith(body, 'a.pdf', 'application/pdf')), RULES));
			expect(r).toMatchObject({ status: 422, code: 'validation_failed' });
		}
		// ohne Sniffing wird nur die Typliste geprüft
		const ok = await readUpload(req(formWith(PNG, 'a.pdf', 'application/pdf')), {
			...RULES,
			sniff: false
		});
		expect(ok.contentType).toBe('application/pdf');
	});
	it('zu groß → 413 (auch schon über content-length)', async () => {
		const big = new Uint8Array(2048);
		big.set(PDF);
		const r = await failure(readUpload(req(formWith(big, 'a.pdf', 'application/pdf')), RULES));
		expect(r).toMatchObject({ status: 413, code: 'payload_too_large' });
		const early = await failure(
			readUpload(req('x', { 'content-length': String(10 * 1024 * 1024) }), RULES)
		);
		expect(early.status).toBe(413);
	});
	it('kaputter Body → 400', async () => {
		const r = await failure(readUpload(req('kein multipart'), RULES));
		expect(r).toMatchObject({ status: 400, code: 'bad_request' });
	});
	it('optional: leeres Feld = null, eigenes Feld als Pfad', async () => {
		expect(await takeUpload(new FormData(), { ...RULES, required: false })).toBeNull();
		expect(
			await takeUpload(formWith('', 'leer.pdf', 'application/pdf'), { ...RULES, required: false })
		).toBeNull();
		const r = await failure(
			takeUpload(formWith('x', 'a.txt', 'text/plain', 'beleg'), { ...RULES, field: 'beleg' })
		);
		expect((r.details as { path: string[] }[])[0]!.path).toEqual(['beleg']);
	});
	it('fehlender Client-Typ: aus dem Inhalt (detectMissingType)', async () => {
		const f = await checkUploadBytes(
			{ bytes: PNG, contentType: '' },
			{
				...RULES,
				detectMissingType: true
			}
		);
		expect(f.contentType).toBe('image/png');
		expect(f.name).toBe('datei');
	});
});

describe('safeFileName / contentDisposition', () => {
	it('bereinigt, entfernt Pfadteile, behält die Endung beim Kürzen', () => {
		expect(safeFileName('Rechnung Müller.pdf')).toBe('Rechnung_Muller.pdf');
		expect(safeFileName('../../etc/passwd')).not.toContain('/');
		expect(safeFileName('...')).toBe('datei');
		expect(safeFileName('...', { fallback: 'beleg' })).toBe('beleg');
		expect(safeFileName('Süd Lager', { german: true, replacement: '-' })).toBe('Sued-Lager');
		const long = safeFileName(`${'a'.repeat(200)}.pdf`);
		expect(long.length).toBe(100);
		expect(long.endsWith('.pdf')).toBe(true);
	});
	it('Umlaut-Dateiname → filename* (RFC 5987) und ASCII-Ersatz', () => {
		expect(contentDisposition('attachment', 'Beleg Müller.pdf')).toBe(
			`attachment; filename="Beleg Muller.pdf"; filename*=UTF-8''Beleg%20M%C3%BCller.pdf`
		);
	});
});
