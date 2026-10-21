/**
 * Issue #6: Signaturprüfung vor dem ersten Decoder-Aufruf und gesperrte libvips-Loader.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// sharp durchreichen, aber jeden Aufruf mitzählen
vi.mock('sharp', async (importOriginal) => {
	const actual = (await importOriginal()) as { default: typeof import('sharp') };
	const real = actual.default;
	const call = real as unknown as (...args: unknown[]) => unknown;
	const spy = vi.fn((...args: unknown[]) => call(...args));
	Object.assign(spy, real);
	return { default: spy };
});

const sharp = (await import('sharp')).default;
/** derselbe (gemockte) Export, als Spy typisiert */
const sharpSpy = sharp as unknown as Mock;
const { processImage, sniffImageFormat } = await import('../../src/lib/server/core/images');
const { CoreError } = await import('../../src/lib/server/core/errors');

const enc = (s: string) => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

/** ISO-BMFF-`ftyp`-Box mit Haupt- und kompatiblen Marken, danach Füllbytes */
function ftyp(major: string, compatible: string[]): Uint8Array {
	const size = 16 + compatible.length * 4;
	const head = new Uint8Array([
		(size >>> 24) & 255,
		(size >>> 16) & 255,
		(size >>> 8) & 255,
		size & 255
	]);
	return concat(head, enc('ftyp' + major + '\0\0\0\0' + compatible.join('')), new Uint8Array(64));
}

const SVG = enc(
	'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
);
const PDF = enc('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
const TIFF = concat(new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0]), new Uint8Array(64));
const TIFF_BE = concat(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0x08]), new Uint8Array(64));
const HEIC = ftyp('heic', ['mif1', 'heic']);
const HEIC_WITH_AVIF_BRAND = ftyp('mif1', ['heic', 'avif']);

async function expectRejected(input: Uint8Array): Promise<void> {
	let caught: unknown;
	try {
		await processImage(input, { variants: [{ name: 'thumb', maxEdge: 100 }] });
	} catch (err) {
		caught = err;
	}
	expect(caught).toBeInstanceOf(CoreError);
	expect((caught as InstanceType<typeof CoreError>).code).toBe('bad_request');
}

describe('sniffImageFormat', () => {
	it('erkennt die erlaubten Signaturen', async () => {
		const base = sharp({ create: { width: 4, height: 4, channels: 3, background: '#c33' } });
		for (const f of ['jpeg', 'png', 'webp', 'gif', 'avif'] as const) {
			const bytes = new Uint8Array(await base.clone().toFormat(f).toBuffer());
			expect(sniffImageFormat(bytes)).toBe(f);
		}
		expect(sniffImageFormat(ftyp('mif1', ['avif', 'miaf']))).toBe('avif');
		expect(sniffImageFormat(ftyp('avis', ['msf1']))).toBe('avif');
	});

	it('weist SVG, TIFF, PDF, HEIC, Text und abgeschnittene Köpfe ab', () => {
		for (const bytes of [SVG, PDF, TIFF, TIFF_BE, HEIC, HEIC_WITH_AVIF_BRAND]) {
			expect(sniffImageFormat(bytes)).toBeNull();
		}
		expect(sniffImageFormat(enc('hallo welt'))).toBeNull();
		expect(sniffImageFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
		expect(sniffImageFormat(enc('RIFF\0\0\0\0WAVE'))).toBeNull();
		// ftyp-Box größer als die Datei
		const broken = ftyp('avif', []);
		broken[3] = 200;
		expect(sniffImageFormat(broken.slice(0, 40))).toBeNull();
	});
});

describe('processImage – Härtung', () => {
	beforeEach(() => {
		sharpSpy.mockClear();
	});

	it('weist SVG, TIFF, HEIC und PDF ab, ohne sharp aufzurufen', async () => {
		for (const bytes of [SVG, TIFF, TIFF_BE, HEIC, HEIC_WITH_AVIF_BRAND, PDF]) {
			await expectRejected(bytes);
		}
		expect(sharpSpy).not.toHaveBeenCalled();
	});

	it('verarbeitet erlaubte Formate weiterhin', async () => {
		const png = new Uint8Array(
			await sharp({ create: { width: 20, height: 10, channels: 3, background: '#3c3' } })
				.png()
				.toBuffer()
		);
		const res = await processImage(png, { variants: [{ name: 'thumb', maxEdge: 10 }] });
		expect(res.format).toBe('png');
		expect(res.variants[0]).toMatchObject({ width: 10, height: 5 });
	});

	it('sperrt nicht benötigte libvips-Loader prozessweit', async () => {
		const svgBuf = Buffer.from(SVG);
		await expect(sharp(svgBuf).metadata()).rejects.toThrow(/unsupported image format/i);
		const realTiff = await sharp({
			create: { width: 4, height: 4, channels: 3, background: '#33c' }
		})
			.tiff()
			.toBuffer();
		await expect(sharp(realTiff).metadata()).rejects.toThrow(/unsupported image format/i);
		// Erlaubte Loader funktionieren
		const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#33c' } })
			.jpeg()
			.toBuffer();
		await expect(sharp(jpeg).metadata()).resolves.toMatchObject({ format: 'jpeg' });
	});

	it('weist eine echte TIFF-Datei mit Bild-Inhalt vor dem Decoder ab', async () => {
		const realTiff = new Uint8Array(
			await sharp({ create: { width: 4, height: 4, channels: 3, background: '#33c' } })
				.tiff()
				.toBuffer()
		);
		sharpSpy.mockClear();
		await expectRejected(realTiff);
		expect(sharpSpy).not.toHaveBeenCalled();
	});
});
