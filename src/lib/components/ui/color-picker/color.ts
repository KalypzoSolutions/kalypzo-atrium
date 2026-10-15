/** Reine Farbfunktionen (ohne Svelte). Ausgabe immer `#rrggbb` in Kleinbuchstaben. */

export type Rgb = { r: number; g: number; b: number };
/** h: 0-360, s und v: 0-1 */
export type Hsv = { h: number; s: number; v: number };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** `#abc` / `#AABBCC` -> `#aabbcc`; sonst `null`. */
export function normalizeHex(value: string): string | null {
	if (typeof value !== 'string') return null;
	const v = value.trim().toLowerCase();
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
	if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
	return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

export function hexToRgb(hex: string): Rgb | null {
	const n = normalizeHex(hex);
	if (!n) return null;
	return {
		r: parseInt(n.slice(1, 3), 16),
		g: parseInt(n.slice(3, 5), 16),
		b: parseInt(n.slice(5, 7), 16)
	};
}

export function rgbToHex({ r, g, b }: Rgb): string {
	const part = (c: number) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0');
	return `#${part(r)}${part(g)}${part(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const d = max - min;
	let h = 0;
	if (d !== 0) {
		if (max === rn) h = ((gn - bn) / d) % 6;
		else if (max === gn) h = (bn - rn) / d + 2;
		else h = (rn - gn) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
	const hh = ((h % 360) + 360) % 360;
	const ss = clamp(s, 0, 1);
	const vv = clamp(v, 0, 1);
	const c = vv * ss;
	const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
	const m = vv - c;
	const [r, g, b] =
		hh < 60
			? [c, x, 0]
			: hh < 120
				? [x, c, 0]
				: hh < 180
					? [0, c, x]
					: hh < 240
						? [0, x, c]
						: hh < 300
							? [x, 0, c]
							: [c, 0, x];
	return {
		r: Math.round((r + m) * 255),
		g: Math.round((g + m) * 255),
		b: Math.round((b + m) * 255)
	};
}

export function hexToHsv(hex: string): Hsv | null {
	const rgb = hexToRgb(hex);
	return rgb ? rgbToHsv(rgb) : null;
}

export function hsvToHex(hsv: Hsv): string {
	return rgbToHex(hsvToRgb(hsv));
}

/** Lesbare Textfarbe (schwarz/weiss) auf der Hintergrundfarbe `hex` (WCAG-Kontrast). */
export function contrastTextColor(hex: string): '#000000' | '#ffffff' {
	const rgb = hexToRgb(hex);
	if (!rgb) return '#000000';
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	const L = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
	// Kontrast zu Schwarz ((L + 0.05) / 0.05) vs. Weiss (1.05 / (L + 0.05))
	return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000000' : '#ffffff';
}
