/**
 * Bildverarbeitung für Module (sharp, nur Server). Zugriff für Module über `core.images`.
 *
 * `processImage` prüft den Inhalt (nicht nur den angegebenen Typ), dreht nach EXIF-Ausrichtung,
 * entfernt ALLE Metadaten (EXIF inkl. GPS, ICC wird in sRGB umgerechnet, XMP, IPTC) und erzeugt
 * die angeforderten Varianten. Es wird nie ein Bild mit Original-Metadaten zurückgegeben.
 */
import sharp from 'sharp';
import { CoreError, errors } from '../errors';

/** Eingangsformate (per sharp-Metadaten erkannt; GIF nur erstes Bild) */
export const IMAGE_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'gif'] as const;
export type ImageInputFormat = (typeof IMAGE_INPUT_FORMATS)[number];

/** Standardgrenze für Eingabepixel (Schutz vor Dekompressionsbomben) */
export const MAX_INPUT_PIXELS = 50_000_000;
/** Standardgrenze für Eingabebytes */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export interface ImageVariantSpec {
	/** Name der Variante, z. B. `thumb`, `web`, `full` */
	name: string;
	/** Lange Kante in Pixeln; `null` = Originalgröße (nie vergrößern) */
	maxEdge: number | null;
	/**
	 * Ausgabeformat: `webp` | `jpeg` | `png` | `auto` (= JPEG, bei Transparenz PNG).
	 * Standard `webp`.
	 */
	format?: 'webp' | 'jpeg' | 'png' | 'auto';
	/** Qualität 1–100 (WebP/JPEG), Standard 80 */
	quality?: number;
}

export interface ProcessedVariant {
	name: string;
	bytes: Uint8Array;
	contentType: 'image/webp' | 'image/jpeg' | 'image/png';
	/** Dateiendung ohne Punkt: `webp` | `jpg` | `png` */
	extension: 'webp' | 'jpg' | 'png';
	width: number;
	height: number;
}

export interface ProcessedImage {
	/** Erkanntes Eingabeformat */
	format: ImageInputFormat;
	/** Maße NACH EXIF-Drehung */
	width: number;
	height: number;
	hasAlpha: boolean;
	variants: ProcessedVariant[];
}

export interface ProcessImageOptions {
	variants: ImageVariantSpec[];
	/** Standard `MAX_INPUT_PIXELS` */
	maxInputPixels?: number;
	/** Standard `MAX_INPUT_BYTES` */
	maxInputBytes?: number;
}

/**
 * Verarbeitet ein hochgeladenes Bild.
 * Fehler: leer/unlesbar/nicht unterstützt → `errors.badRequest` (ASCII-deutsch),
 * zu groß (Bytes) → `errors.tooLarge`, zu viele Pixel → `errors.badRequest`.
 */
export async function processImage(
	input: Uint8Array,
	options: ProcessImageOptions
): Promise<ProcessedImage> {
	const maxBytes = options.maxInputBytes ?? MAX_INPUT_BYTES;
	const maxPixels = options.maxInputPixels ?? MAX_INPUT_PIXELS;
	if (!input || input.byteLength === 0) throw errors.badRequest('Die Datei ist leer');
	if (input.byteLength > maxBytes) throw errors.tooLarge('Das Bild ist zu groß');

	const sharpOptions: sharp.SharpOptions = {
		failOn: 'error',
		limitInputPixels: maxPixels,
		animated: false,
		pages: 1,
		page: 0
	};

	let meta: sharp.Metadata;
	try {
		meta = await sharp(input, sharpOptions).metadata();
	} catch (err) {
		throw translateSharpError(err);
	}

	const format = normalizeFormat(meta);
	if (!format) throw errors.badRequest(UNSUPPORTED);
	const rawWidth = meta.width ?? 0;
	// Bei mehrseitigen Bildern (GIF) nur die erste Seite
	const rawHeight = meta.pageHeight ?? meta.height ?? 0;
	if (rawWidth <= 0 || rawHeight <= 0) throw errors.badRequest(UNREADABLE);
	if (rawWidth * rawHeight > maxPixels) throw errors.badRequest(TOO_MANY_PIXELS);

	// EXIF-Ausrichtung 5–8 vertauscht Breite und Höhe
	const swap = (meta.orientation ?? 1) >= 5 && (meta.orientation ?? 1) <= 8;
	const width = swap ? rawHeight : rawWidth;
	const height = swap ? rawWidth : rawHeight;
	const hasAlpha = meta.hasAlpha === true;

	const variants: ProcessedVariant[] = [];
	for (const spec of options.variants) {
		variants.push(await renderVariant(input, sharpOptions, spec, hasAlpha));
	}
	return { format, width, height, hasAlpha, variants };
}

const UNSUPPORTED = 'Dateityp nicht unterstützt (JPEG, PNG, WebP, AVIF oder GIF)';
const UNREADABLE = 'Bild konnte nicht gelesen werden';
const TOO_MANY_PIXELS = 'Das Bild hat zu viele Pixel';

function normalizeFormat(meta: sharp.Metadata): ImageInputFormat | null {
	const format: string | undefined = meta.format;
	if (!format) return null;
	// libvips meldet AVIF als `heif` mit Kompression `av1`; HEIC (hevc) bleibt unzulässig
	if (format === 'heif') return meta.compression === 'av1' ? 'avif' : null;
	const f = format === 'jpg' ? 'jpeg' : format;
	return (IMAGE_INPUT_FORMATS as readonly string[]).includes(f) ? (f as ImageInputFormat) : null;
}

function translateSharpError(err: unknown): CoreError {
	if (err instanceof CoreError) return err;
	const message = err instanceof Error ? err.message : String(err);
	if (/pixel limit/i.test(message)) return errors.badRequest(TOO_MANY_PIXELS);
	if (/unsupported image format/i.test(message)) return errors.badRequest(UNSUPPORTED);
	return errors.badRequest(UNREADABLE);
}

function clampQuality(q: number | undefined): number {
	if (q === undefined || !Number.isFinite(q)) return 80;
	return Math.min(100, Math.max(1, Math.round(q)));
}

async function renderVariant(
	input: Uint8Array,
	sharpOptions: sharp.SharpOptions,
	spec: ImageVariantSpec,
	hasAlpha: boolean
): Promise<ProcessedVariant> {
	const requested = spec.format ?? 'webp';
	const target = requested === 'auto' ? (hasAlpha ? 'png' : 'jpeg') : requested;
	const quality = clampQuality(spec.quality);

	// Ohne withMetadata/keepExif entfernt sharp EXIF (inkl. GPS), XMP, IPTC und ICC;
	// toColourspace rechnet eingebettete Profile vorher nach sRGB um.
	let pipeline = sharp(input, sharpOptions).rotate().toColourspace('srgb');
	if (spec.maxEdge !== null) {
		const edge = Math.max(1, Math.floor(spec.maxEdge));
		pipeline = pipeline.resize({
			width: edge,
			height: edge,
			fit: 'inside',
			withoutEnlargement: true
		});
	}
	if (target === 'webp') pipeline = pipeline.webp({ quality });
	else if (target === 'jpeg') pipeline = pipeline.jpeg({ quality, mozjpeg: true });
	else pipeline = pipeline.png({ compressionLevel: 9 });

	let result: { data: Buffer; info: sharp.OutputInfo };
	try {
		result = await pipeline.toBuffer({ resolveWithObject: true });
	} catch (err) {
		throw translateSharpError(err);
	}
	const { data, info } = result;
	return {
		name: spec.name,
		bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		contentType: target === 'webp' ? 'image/webp' : target === 'jpeg' ? 'image/jpeg' : 'image/png',
		extension: target === 'webp' ? 'webp' : target === 'jpeg' ? 'jpg' : 'png',
		width: info.width,
		height: info.height
	};
}
