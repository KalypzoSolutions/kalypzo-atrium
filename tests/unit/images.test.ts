import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { CoreError } from '../../src/lib/server/core/errors';
import { processImage } from '../../src/lib/server/core/images';

async function makeImage(
	width: number,
	height: number,
	format: 'jpeg' | 'png' | 'webp' | 'gif' | 'avif',
	alpha = false
): Promise<Uint8Array> {
	const img = sharp({
		create: {
			width,
			height,
			channels: alpha ? 4 : 3,
			background: alpha ? { r: 200, g: 50, b: 50, alpha: 0.5 } : { r: 200, g: 50, b: 50 }
		}
	});
	const buf = await img.toFormat(format).toBuffer();
	return new Uint8Array(buf);
}

async function expectCoreError(p: Promise<unknown>, code: string): Promise<CoreError> {
	try {
		await p;
	} catch (err) {
		expect(err).toBeInstanceOf(CoreError);
		expect((err as CoreError).code).toBe(code);
		return err as CoreError;
	}
	throw new Error('Kein Fehler geworfen');
}

describe('processImage', () => {
	it('skaliert auf die lange Kante und vergrößert nie', async () => {
		const input = await makeImage(1200, 800, 'jpeg');
		const res = await processImage(input, {
			variants: [
				{ name: 'thumb', maxEdge: 300 },
				{ name: 'web', maxEdge: 2000 },
				{ name: 'full', maxEdge: null, format: 'jpeg' }
			]
		});
		expect(res.format).toBe('jpeg');
		expect(res.width).toBe(1200);
		expect(res.height).toBe(800);
		const [thumb, web, full] = res.variants;
		expect(thumb).toMatchObject({ name: 'thumb', width: 300, height: 200 });
		expect(thumb!.contentType).toBe('image/webp');
		expect(thumb!.extension).toBe('webp');
		expect(web).toMatchObject({ width: 1200, height: 800 });
		expect(full).toMatchObject({ contentType: 'image/jpeg', extension: 'jpg', width: 1200 });
		expect(thumb!.bytes).toBeInstanceOf(Uint8Array);
		const meta = await sharp(thumb!.bytes).metadata();
		expect(meta.format).toBe('webp');
		expect(meta.width).toBe(300);
	});

	it('dreht nach EXIF-Ausrichtung 6 (Breite/Höhe vertauscht)', async () => {
		const buf = await sharp({
			create: { width: 400, height: 200, channels: 3, background: '#336699' }
		})
			.jpeg()
			.withMetadata({ orientation: 6 })
			.toBuffer();
		expect((await sharp(buf).metadata()).orientation).toBe(6);
		const res = await processImage(new Uint8Array(buf), {
			variants: [
				{ name: 'full', maxEdge: null, format: 'jpeg' },
				{ name: 'thumb', maxEdge: 100 }
			]
		});
		expect(res.width).toBe(200);
		expect(res.height).toBe(400);
		expect(res.variants[0]).toMatchObject({ width: 200, height: 400 });
		expect(res.variants[1]).toMatchObject({ width: 50, height: 100 });
		const outMeta = await sharp(res.variants[0]!.bytes).metadata();
		expect(outMeta.orientation).toBeUndefined();
	});

	it('entfernt EXIF inkl. GPS, XMP und ICC aus allen Ausgaben', async () => {
		const buf = await sharp({
			create: { width: 300, height: 200, channels: 3, background: '#808080' }
		})
			.jpeg()
			.withMetadata({ orientation: 1 })
			.withExif({
				IFD0: { Make: 'Testkamera', Model: 'X1', Copyright: 'Geheim' },
				IFD3: {
					GPSLatitudeRef: 'N',
					GPSLatitude: '53/1 4/1 0/1',
					GPSLongitudeRef: 'E',
					GPSLongitude: '8/1 48/1 0/1'
				}
			})
			.withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>')
			.withIccProfile('p3')
			.toBuffer();
		const inMeta = await sharp(buf).metadata();
		expect(inMeta.exif).toBeDefined();
		expect(Buffer.from(inMeta.exif!).toString('latin1')).toContain('Testkamera');
		expect(inMeta.icc).toBeDefined();

		const res = await processImage(new Uint8Array(buf), {
			variants: [
				{ name: 'webp', maxEdge: null, format: 'webp' },
				{ name: 'jpeg', maxEdge: 100, format: 'jpeg' },
				{ name: 'png', maxEdge: 100, format: 'png' },
				{ name: 'auto', maxEdge: null, format: 'auto' }
			]
		});
		for (const v of res.variants) {
			const meta = await sharp(v.bytes).metadata();
			expect(meta.exif, v.name).toBeUndefined();
			expect(meta.xmp, v.name).toBeUndefined();
			expect(meta.iptc, v.name).toBeUndefined();
			expect(meta.icc, v.name).toBeUndefined();
			expect(Buffer.from(v.bytes).toString('latin1')).not.toContain('Testkamera');
		}
	});

	it('auto: PNG bei Transparenz, sonst JPEG', async () => {
		const alpha = await processImage(await makeImage(100, 80, 'png', true), {
			variants: [{ name: 'a', maxEdge: null, format: 'auto' }]
		});
		expect(alpha.hasAlpha).toBe(true);
		expect(alpha.variants[0]).toMatchObject({ contentType: 'image/png', extension: 'png' });
		expect((await sharp(alpha.variants[0]!.bytes).metadata()).hasAlpha).toBe(true);

		const opaque = await processImage(await makeImage(100, 80, 'png'), {
			variants: [{ name: 'a', maxEdge: null, format: 'auto' }]
		});
		expect(opaque.hasAlpha).toBe(false);
		expect(opaque.variants[0]).toMatchObject({ contentType: 'image/jpeg', extension: 'jpg' });
		expect((await sharp(opaque.variants[0]!.bytes).metadata()).format).toBe('jpeg');
	});

	it('akzeptiert WebP, GIF und AVIF', async () => {
		for (const f of ['webp', 'gif', 'avif'] as const) {
			const res = await processImage(await makeImage(64, 32, f), {
				variants: [{ name: 't', maxEdge: 32 }]
			});
			expect(res.format).toBe(f);
			expect(res.variants[0]).toMatchObject({ width: 32, height: 16 });
		}
	});

	it('lehnt Textdatei, leere Datei, zu große Datei und zu viele Pixel ab', async () => {
		const text = new TextEncoder().encode('Hallo, ich bin kein Bild.\n'.repeat(20));
		const e1 = await expectCoreError(processImage(text, { variants: [] }), 'bad_request');
		expect(e1.message).toMatch(/nicht unterstützt|nicht gelesen/);

		await expectCoreError(processImage(new Uint8Array(0), { variants: [] }), 'bad_request');

		const img = await makeImage(50, 50, 'png');
		await expectCoreError(
			processImage(img, { variants: [], maxInputBytes: img.byteLength - 1 }),
			'payload_too_large'
		);

		const big = await makeImage(200, 200, 'jpeg');
		const e2 = await expectCoreError(
			processImage(big, { variants: [{ name: 't', maxEdge: 10 }], maxInputPixels: 10_000 }),
			'bad_request'
		);
		expect(e2.message).toContain('Pixel');
	});

	it('lehnt abgeschnittene Bilder ab', async () => {
		const img = await makeImage(300, 300, 'jpeg');
		const broken = img.slice(0, Math.floor(img.byteLength / 2));
		await expectCoreError(
			processImage(broken, { variants: [{ name: 't', maxEdge: 100 }] }),
			'bad_request'
		);
	});
});
