/**
 * Erste Seite (bzw. eine Seite) eines PDFs als PNG rendern – für Vorschaubilder. Zugriff für Module über
 * `core.pdf.renderPage`.
 *
 * pdf.js (`pdfjs-dist`, Legacy-Build für Node) + `@napi-rs/canvas`; kein Chromium, kein Ghostscript.
 * Härtung: pdf.js ≥ 6 nutzt kein `eval`; keine Systemschriften, kein XFA, Standardschriften/CMaps nur aus dem
 * lokalen Paket, Eingabe ≤ `MAX_PDF_RASTER_BYTES`, Ausgabe ≤ `MAX_RASTER_PIXELS`, Zeitlimit, höchstens ein Lauf
 * gleichzeitig je Prozess. sharp bleibt für PDF gesperrt (`images/index.ts`): Aufrufer schicken das PNG danach
 * regulär durch `core.images.process`.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { errors } from '../errors';

export const MAX_PDF_RASTER_BYTES = 50 * 1024 * 1024;
/** Obergrenze der gerenderten Fläche (Schutz vor riesigen Seitenformaten) */
export const MAX_RASTER_PIXELS = 4_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface RenderPdfPageOptions {
	/** 1-basiert, Standard 1 */
	page?: number;
	/** Lange Kante in Pixeln (Standard 800) */
	maxEdge?: number;
	/** Standard 10 s */
	timeoutMs?: number;
}

export interface RenderedPdfPage {
	png: Uint8Array;
	width: number;
	height: number;
	pageCount: number;
}

let assetDir: string | null = null;
function pdfjsAssets(): string {
	if (!assetDir) {
		const require = createRequire(import.meta.url);
		assetDir = dirname(require.resolve('pdfjs-dist/package.json'));
	}
	return assetDir;
}

/** Ein Lauf gleichzeitig: Rendern ist CPU- und speicherintensiv */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
	const run = queue.then(fn, fn);
	queue = run.catch(() => undefined);
	return run;
}

function isPdf(bytes: Uint8Array): boolean {
	// Signatur „%PDF-“ in den ersten 1024 Byte (manche Erzeuger setzen Müll davor)
	const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
	return head.includes('%PDF-');
}

export async function renderPdfPage(
	bytes: Uint8Array,
	options: RenderPdfPageOptions = {}
): Promise<RenderedPdfPage> {
	if (bytes.byteLength > MAX_PDF_RASTER_BYTES) throw errors.tooLarge('Das PDF ist zu groß.');
	if (!isPdf(bytes)) throw errors.validation({ file: 'Kein PDF' }, 'Die Datei ist kein PDF.');
	const pageNo = Math.max(1, Math.floor(options.page ?? 1));
	const maxEdge = Math.min(4000, Math.max(16, Math.floor(options.maxEdge ?? 800)));
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return serial(() => renderNow(bytes, pageNo, maxEdge, timeoutMs));
}

async function renderNow(
	bytes: Uint8Array,
	pageNo: number,
	maxEdge: number,
	timeoutMs: number
): Promise<RenderedPdfPage> {
	const [{ getDocument }, { createCanvas }] = await Promise.all([
		import('pdfjs-dist/legacy/build/pdf.mjs'),
		import('@napi-rs/canvas')
	]);
	const base = pdfjsAssets();
	const task = getDocument({
		// Kopie: pdf.js übernimmt (detacht) den Puffer
		data: new Uint8Array(bytes),
		disableFontFace: true,
		useSystemFonts: false,
		enableXfa: false,
		verbosity: 0,
		standardFontDataUrl: join(base, 'standard_fonts') + '/',
		cMapUrl: join(base, 'cmaps') + '/',
		cMapPacked: true
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(errors.unavailable('Die PDF-Vorschau hat zu lange gedauert.')),
			timeoutMs
		);
	});
	try {
		const work = (async () => {
			const pdf = await task.promise;
			if (pageNo > pdf.numPages) throw errors.notFound('Seite nicht vorhanden');
			const page = await pdf.getPage(pageNo);
			const unit = page.getViewport({ scale: 1 });
			let scale = maxEdge / Math.max(unit.width, unit.height, 1);
			const area = unit.width * unit.height * scale * scale;
			if (area > MAX_RASTER_PIXELS) scale *= Math.sqrt(MAX_RASTER_PIXELS / area);
			const viewport = page.getViewport({ scale });
			const width = Math.max(1, Math.ceil(viewport.width));
			const height = Math.max(1, Math.ceil(viewport.height));
			const canvas = createCanvas(width, height);
			const context = canvas.getContext('2d');
			context.fillStyle = '#ffffff';
			context.fillRect(0, 0, width, height);
			await page.render({
				canvas: canvas as unknown as HTMLCanvasElement,
				canvasContext: context as unknown as CanvasRenderingContext2D,
				viewport
			}).promise;
			const png = new Uint8Array(canvas.toBuffer('image/png'));
			return { png, width, height, pageCount: pdf.numPages };
		})();
		return await Promise.race([work, timeout]);
	} finally {
		clearTimeout(timer);
		await task.destroy().catch(() => undefined);
	}
}
