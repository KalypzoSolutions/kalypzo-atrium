/** Reine Hilfen für den Verlaufseditor (Test `tests/unit/gradient-editor.test.ts`). */
import {
	backgroundColors,
	SPOTS_MAX,
	STOPS_MAX,
	STOPS_MIN,
	type BackgroundKind,
	type GradientStop,
	type MeshSpot,
	type ThemeBackground
} from '$lib/appearance';
import { hexToRgb, rgbToHex } from '$lib/components/ui/color-picker/color';

const clampPos = (n: number) => Math.round(Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0)));

/** Farbe an einer Stelle des Verlaufs (lineare Interpolation in sRGB) */
export function colorAt(stops: GradientStop[], pos: number): string {
	const sorted = [...stops].sort((a, b) => a.pos - b.pos);
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	if (!first || !last) return '#ffffff';
	if (pos <= first.pos) return first.color;
	if (pos >= last.pos) return last.color;
	for (let i = 1; i < sorted.length; i++) {
		const a = sorted[i - 1]!;
		const b = sorted[i]!;
		if (pos <= b.pos) {
			const t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos);
			const ca = hexToRgb(a.color);
			const cb = hexToRgb(b.color);
			if (!ca || !cb) return a.color;
			return rgbToHex({
				r: Math.round(ca.r + (cb.r - ca.r) * t),
				g: Math.round(ca.g + (cb.g - ca.g) * t),
				b: Math.round(ca.b + (cb.b - ca.b) * t)
			});
		}
	}
	return last.color;
}

/** Neuer Farbpunkt an `pos` (Farbe des Verlaufs an dieser Stelle); voll → unverändert */
export function addStop(
	stops: GradientStop[],
	pos: number
): { stops: GradientStop[]; index: number } {
	if (stops.length >= STOPS_MAX) return { stops, index: -1 };
	const p = clampPos(pos);
	const next = [...stops, { color: colorAt(stops, p), pos: p }];
	return { stops: next, index: next.length - 1 };
}

export function removeStop(stops: GradientStop[], index: number): GradientStop[] {
	if (stops.length <= STOPS_MIN || index < 0 || index >= stops.length) return stops;
	return stops.filter((_, i) => i !== index);
}

export function moveStop(stops: GradientStop[], index: number, pos: number): GradientStop[] {
	return stops.map((s, i) => (i === index ? { ...s, pos: clampPos(pos) } : s));
}

/** Verteilte Flecken für Mesh aus einer Farbliste */
function spotsFrom(colors: string[]): MeshSpot[] {
	const places: [number, number][] = [
		[10, 10],
		[90, 15],
		[60, 95],
		[15, 85],
		[85, 70]
	];
	return colors.slice(0, SPOTS_MAX).map((color, i) => ({
		color,
		x: places[i]![0],
		y: places[i]![1],
		size: 55
	}));
}

/** Art wechseln und dabei die vorhandenen Farben übernehmen */
export function convertBackground(bg: ThemeBackground, kind: BackgroundKind): ThemeBackground {
	if (bg.kind === kind) return bg;
	const colors = backgroundColors(bg);
	const first = colors[0] ?? '#f1f5f9';
	const stopColors = colors.length >= STOPS_MIN ? colors.slice(0, STOPS_MAX) : [first, '#ffffff'];
	const stops: GradientStop[] =
		bg.kind === 'linear' || bg.kind === 'radial'
			? bg.stops
			: stopColors.map((color, i) => ({
					color,
					pos: Math.round((i / (stopColors.length - 1)) * 100)
				}));
	switch (kind) {
		case 'solid':
			return { kind, color: first };
		case 'linear':
			return { kind, angle: 135, stops };
		case 'radial':
			return { kind, at: 'center', stops };
		case 'mesh': {
			const spotColors = bg.kind === 'mesh' ? [] : colors.slice(bg.kind === 'solid' ? 0 : 1);
			return {
				kind,
				base: first,
				spots: spotsFrom(spotColors.length ? spotColors : ['#c7d2fe', '#a7f3d0'])
			};
		}
	}
}

export function addSpot(spots: MeshSpot[]): MeshSpot[] {
	if (spots.length >= SPOTS_MAX) return spots;
	return [...spots, { color: '#c4b5fd', x: 50, y: 50, size: 50 }];
}
