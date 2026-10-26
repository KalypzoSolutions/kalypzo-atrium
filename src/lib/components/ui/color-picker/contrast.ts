/**
 * Gemeinsame Kontrastberechnung (WCAG 2.x) für Farbwähler, Kalender, Badges, Akzentfarbe und den
 * Token-Kontrasttest. Reine Funktionen ohne Svelte/DOM.
 *
 * Unterstützte Farbangaben: `#rgb`, `#rrggbb`, `oklch(L C H)` / `oklch(L C H / A)` (L als Zahl 0–1 oder Prozent).
 */

export type RgbTuple = [number, number, number];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** `#abc` / `#aabbcc` → `[r, g, b]` (0–255), sonst `null`. */
export function parseHex(value: string | null | undefined): RgbTuple | null {
	if (typeof value !== 'string') return null;
	const v = value.trim().toLowerCase();
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
	const hex = short
		? `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
		: /^#([0-9a-f]{6})$/.exec(v)?.[1];
	if (!hex) return null;
	return [
		parseInt(hex.slice(0, 2), 16),
		parseInt(hex.slice(2, 4), 16),
		parseInt(hex.slice(4, 6), 16)
	];
}

/** sRGB-Kanal (0–1, gamma-kodiert) → linear */
function toLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
/** linear → sRGB-Kanal (0–1, gamma-kodiert) */
function fromLinear(c: number): number {
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** OKLCH → sRGB (0–255, auf den Farbraum geklemmt). */
export function oklchToRgb(l: number, c: number, h: number): RgbTuple {
	const hr = (h * Math.PI) / 180;
	const a = c * Math.cos(hr);
	const b = c * Math.sin(hr);
	const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = l - 0.0894841775 * a - 1.291485548 * b;
	const L = l_ ** 3;
	const M = m_ ** 3;
	const S = s_ ** 3;
	const r = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
	const g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
	const bl = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;
	return [r, g, bl].map((v) => Math.round(clamp01(fromLinear(v)) * 255)) as RgbTuple;
}

/** sRGB (0–255) → OKLCH `[L 0–1, C, H in Grad]`. */
export function rgbToOklch([r, g, b]: RgbTuple): [number, number, number] {
	const R = toLinear(r / 255);
	const G = toLinear(g / 255);
	const B = toLinear(b / 255);
	const l_ = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
	const m_ = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
	const s_ = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
	const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
	const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
	const h = (Math.atan2(bb, a) * 180) / Math.PI;
	return [L, Math.sqrt(a * a + bb * bb), h < 0 ? h + 360 : h];
}

/** `#…` oder `oklch(…)` → sRGB; Alpha wird ignoriert. Unbekanntes Format → `null`. */
export function parseColor(value: string | null | undefined): RgbTuple | null {
	if (typeof value !== 'string') return null;
	const hex = parseHex(value);
	if (hex) return hex;
	const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+%?\s*)?\)$/i.exec(
		value.trim()
	);
	if (!m) return null;
	const l = Number(m[1]) / (m[2] ? 100 : 1);
	return oklchToRgb(l, Number(m[3]), Number(m[4]));
}

/** Relative Luminanz nach WCAG 2.x (0 = schwarz, 1 = weiß). */
export function relativeLuminance([r, g, b]: RgbTuple): number {
	return 0.2126 * toLinear(r / 255) + 0.7152 * toLinear(g / 255) + 0.0722 * toLinear(b / 255);
}

/** Kontrastverhältnis zweier Farben (1–21). */
export function contrastRatio(a: RgbTuple, b: RgbTuple): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Kontrast zweier Farbangaben (`#…`/`oklch(…)`); ungültig → `null`. */
export function contrastOf(fg: string, bg: string): number | null {
	const a = parseColor(fg);
	const b = parseColor(bg);
	return a && b ? contrastRatio(a, b) : null;
}

/**
 * Wählt aus zwei Textfarben die mit dem höheren Kontrast zur Hintergrundfarbe `bg`.
 * Ungültige Hintergrundfarbe → `null`.
 */
export function readableOn<T extends string>(bg: string, light: T, dark: T): T | null {
	const b = parseColor(bg);
	const l = parseColor(light);
	const d = parseColor(dark);
	if (!b || !l || !d) return null;
	return contrastRatio(d, b) >= contrastRatio(l, b) ? dark : light;
}

/** Vordergrund-Farben für Primärflächen (identisch mit `--primary-foreground` in `app.css`). */
export const PRIMARY_FOREGROUND_LIGHT = '#fafafa';
export const PRIMARY_FOREGROUND_DARK = '#0a0a0a';
/**
 * Schwelle der genäherten Luminanz (Gamma 2,2): darunter heller, darüber dunkler Text. Muss mit
 * `app.css` (`clamp(0.04, (0.18 - Y) * 1000, 0.98)`) übereinstimmen – der Token-Test prüft das.
 * 0,18 ist der Wert, bei dem für keine Farbe die schlechtere der beiden Textfarben gewählt wird,
 * wenn nur die bessere 4,5 : 1 erreicht.
 */
export const PRIMARY_FOREGROUND_THRESHOLD = 0.18;

/** Luminanz mit Gamma 2,2 – so, wie sie `app.css` per `pow(r, 2.2)` im Browser berechnet. */
export function approxLuminance([r, g, b]: RgbTuple): number {
	return 0.2126 * (r / 255) ** 2.2 + 0.7152 * (g / 255) ** 2.2 + 0.0722 * (b / 255) ** 2.2;
}

/**
 * Textfarbe auf der Akzentfarbe (Primärknöpfe, Badges, Auswahl) – dieselbe Regel, die `app.css`
 * per `color(from var(--primary) srgb …)` im Browser anwendet. Ungültige Farbe → heller Text.
 */
export function primaryForeground(accent: string): string {
	const rgb = parseColor(accent);
	if (!rgb) return PRIMARY_FOREGROUND_LIGHT;
	return approxLuminance(rgb) < PRIMARY_FOREGROUND_THRESHOLD
		? PRIMARY_FOREGROUND_LIGHT
		: PRIMARY_FOREGROUND_DARK;
}

/** Kontrast der automatisch gewählten Textfarbe auf der Akzentfarbe (für Hinweise im Farbwähler). */
export function primaryContrast(accent: string): number | null {
	return contrastOf(primaryForeground(accent), accent);
}
