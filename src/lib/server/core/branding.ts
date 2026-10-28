/**
 * Logo des Stammes als Favicon, App-Icon (PWA, iOS, Push) und Bild in Seitenleiste/Login (nur Server).
 *
 * Gespeichert wird nur das Logo (`core.design.logoFileId`, Storage `core/branding/…`, beim Hochladen per
 * `processImage` neu kodiert: PNG ≤ 1024 px, ohne Metadaten). Die Icons entstehen bei Bedarf daraus (sharp,
 * quadratisch mit Rand, bei Apple/maskierbar auf `core.design.iconBackground`) und werden im Prozess
 * gecacht. Ohne Logo oder ohne Speicher liefern die Routen das Wappen aus `static/icons/`.
 */
import sharp from 'sharp';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from './audit/service';
import { matchesImageSignature } from './auth/profile';
import { errors } from './errors';
import { processImage } from './images';
import { requirePermission } from './permissions/service';
import { getSetting, setSetting } from './settings/service';
import { readFileByIdUnchecked, upload } from './storage';

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_MAX_EDGE = 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^#[0-9a-f]{6}$/i;

interface IconSpec {
	size: number;
	/** Rand je Seite als Anteil der Kantenlänge */
	pad: number;
	/** Fläche in der Icon-Hintergrundfarbe (sonst transparent) */
	filled: boolean;
	/** Datei unter `static/icons/`, wenn kein Logo gesetzt ist */
	fallback: string;
}

/** Ausgelieferte Icons (Name = letzter Pfadteil unter `/branding/`) */
export const BRAND_ICONS: Record<string, IconSpec> = {
	'favicon-32.png': { size: 32, pad: 0, filled: false, fallback: 'favicon-32.png' },
	'apple-touch-icon.png': { size: 180, pad: 0.1, filled: true, fallback: 'apple-touch-icon.png' },
	'icon-192.png': { size: 192, pad: 0.04, filled: false, fallback: 'icon-192.png' },
	'icon-512.png': { size: 512, pad: 0.04, filled: false, fallback: 'icon-512.png' },
	// Sicherer Bereich maskierbarer Icons: Kreis mit 80 % Durchmesser → Logo auf 64 %
	'maskable-512.png': { size: 512, pad: 0.18, filled: true, fallback: 'maskable-512.png' }
};

export interface BrandingState {
	logoId: string | null;
	background: string;
}

/** Aktuelles Logo + Icon-Hintergrund (Fehler beim Lesen = kein Logo) */
export async function brandingState(): Promise<BrandingState> {
	try {
		const [id, bg] = await Promise.all([
			getSetting<string>('core.design.logoFileId'),
			getSetting<string>('core.design.iconBackground')
		]);
		return {
			logoId: typeof id === 'string' && UUID_RE.test(id) ? id : null,
			background: typeof bg === 'string' && HEX_RE.test(bg) ? bg : '#ffffff'
		};
	} catch {
		return { logoId: null, background: '#ffffff' };
	}
}

/** Kurze Version für Cache-Busting in URLs (`?v=`) */
export function brandVersion(state: BrandingState): string {
	return state.logoId ? `${state.logoId.slice(0, 8)}${state.background.slice(1)}` : 'w';
}

/** Adresse des Logos für Seitenleiste/Login, `null` ohne Logo */
export function logoUrl(state: BrandingState): string | null {
	return state.logoId ? `/branding/logo.png?v=${brandVersion(state)}` : null;
}

// --- Cache ------------------------------------------------------------------------------

const CACHE_MAX = 24;
const cache = new Map<string, Uint8Array>();
/** Logos, die nicht gelesen werden konnten (z. B. Speicher nicht erreichbar), kurz merken */
const missing = new Map<string, number>();
const MISSING_TTL_MS = 30_000;

function remember(key: string, bytes: Uint8Array): Uint8Array {
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
	cache.set(key, bytes);
	return bytes;
}

async function logoBytes(logoId: string): Promise<Uint8Array | null> {
	const key = `logo:${logoId}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const miss = missing.get(logoId);
	if (miss && Date.now() - miss < MISSING_TTL_MS) return null;
	const file = await readFileByIdUnchecked(logoId, { module: 'core', pathPrefix: 'branding/' });
	if (!file || !/^image\/(png|jpeg|webp)$/.test(file.contentType)) {
		missing.set(logoId, Date.now());
		return null;
	}
	// Ältere Logos wurden im Original gespeichert: einheitlich als PNG ohne Metadaten ausliefern
	try {
		const png =
			file.contentType === 'image/png' && file.buffer.byteLength <= 2 * 1024 * 1024
				? file.buffer
				: (
						await processImage(file.buffer, {
							variants: [{ name: 'logo', maxEdge: LOGO_MAX_EDGE, format: 'png' }],
							maxInputBytes: LOGO_MAX_BYTES * 2
						})
					).variants[0]!.bytes;
		return remember(key, png);
	} catch {
		missing.set(logoId, Date.now());
		return null;
	}
}

function hexToRgb(hex: string) {
	const n = parseInt(hex.slice(1), 16);
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
}

/** Icon aus einem (bereits geprüften) Logo-PNG rendern */
export async function renderIcon(logo: Uint8Array, spec: IconSpec, background: string) {
	const inner = Math.max(1, Math.round(spec.size * (1 - 2 * spec.pad)));
	const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
	const fitted = await sharp(logo)
		.resize(inner, inner, { fit: 'contain', background: transparent })
		.png()
		.toBuffer();
	const out = await sharp({
		create: {
			width: spec.size,
			height: spec.size,
			channels: 4,
			background: spec.filled ? hexToRgb(background) : transparent
		}
	})
		.composite([{ input: fitted, gravity: 'center' }])
		.png({ compressionLevel: 9 })
		.toBuffer();
	return new Uint8Array(out);
}

/** Icon für `/branding/<name>`; `null` = kein Logo (Wappen ausliefern), unbekannter Name → `undefined` */
export async function brandIcon(
	name: string,
	state: BrandingState
): Promise<Uint8Array | null | undefined> {
	const spec = BRAND_ICONS[name];
	if (!spec) return undefined;
	if (!state.logoId) return null;
	const key = `icon:${state.logoId}:${state.background}:${name}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const logo = await logoBytes(state.logoId);
	if (!logo) return null;
	try {
		return remember(key, await renderIcon(logo, spec, state.background));
	} catch (e) {
		console.error('[core] Icon aus dem Logo nicht erzeugbar:', (e as Error)?.message);
		return null;
	}
}

/** Logo als PNG für Seitenleiste und Login (`null` = kein Logo) */
export async function brandLogo(state: BrandingState): Promise<Uint8Array | null> {
	return state.logoId ? logoBytes(state.logoId) : null;
}

// --- Verwaltung ---------------------------------------------------------------------------

/**
 * Logo setzen (Recht `core.settings.manage`, Speichern braucht `core.storage.write`): Typ und Signatur prüfen,
 * neu kodieren (PNG, Metadaten/GPS entfernt, ≤ 1024 px), hochladen, Einstellung setzen.
 */
export async function setLogo(
	ctx: RequestContext,
	file: { data: Uint8Array; contentType: string; name?: string }
): Promise<string> {
	await requirePermission(ctx, 'core.settings.manage');
	const type = file.contentType.split(';')[0]!.trim().toLowerCase();
	if (!(LOGO_TYPES as readonly string[]).includes(type)) {
		throw errors.badRequest('Erlaubt sind PNG, JPEG und WebP');
	}
	if (file.data.byteLength === 0) throw errors.badRequest('Bitte wähle eine Bilddatei aus');
	if (file.data.byteLength > LOGO_MAX_BYTES) {
		throw errors.tooLarge('Das Logo darf höchstens 5 MB groß sein');
	}
	if (!matchesImageSignature(file.data, type)) {
		throw errors.badRequest('Die Datei ist kein gültiges PNG-, JPEG- oder WebP-Bild');
	}
	const processed = await processImage(file.data, {
		variants: [{ name: 'logo', maxEdge: LOGO_MAX_EDGE, format: 'png' }],
		maxInputBytes: LOGO_MAX_BYTES
	});
	const stored = await upload(ctx, {
		module: 'core',
		path: `branding/logo-${Date.now()}`,
		file: processed.variants[0]!.bytes,
		contentType: 'image/png',
		name: 'logo.png'
	});
	await setSetting(ctx, 'core.design.logoFileId', stored.id);
	await auditFromContext(ctx, 'core.design.logo_updated', { target: stored.id });
	return stored.id;
}

/** Logo entfernen (PDFs, Favicon und App-Icons fallen auf das Wappen zurück) */
export async function removeLogo(ctx: RequestContext): Promise<void> {
	await requirePermission(ctx, 'core.settings.manage');
	await setSetting(ctx, 'core.design.logoFileId', '');
	await auditFromContext(ctx, 'core.design.logo_removed', {});
}
