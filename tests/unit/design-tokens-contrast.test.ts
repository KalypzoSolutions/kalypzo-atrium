/**
 * Kontrast der Design-Tokens aus `src/app.css` (WCAG 2.2 AA: Text ≥ 4,5 : 1) in hell und dunkel.
 * Der Test liest die Custom Properties aus `:root` und `.dark`, löst `var()` und `color-mix()` auf und
 * rechnet mit derselben Kontrastfunktion wie die Oberfläche (`ui/color-picker/contrast.ts`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	PRIMARY_FOREGROUND_DARK,
	PRIMARY_FOREGROUND_LIGHT,
	PRIMARY_FOREGROUND_THRESHOLD,
	contrastRatio,
	parseColor,
	primaryForeground,
	type RgbTuple
} from '../../src/lib/components/ui/color-picker/contrast';

const css = readFileSync(resolve(__dirname, '../../src/app.css'), 'utf8');

/** Custom Properties des ersten Blocks mit genau diesem Selektor */
function block(selector: string): Map<string, string> {
	const start = css.indexOf(`\n${selector} {`);
	if (start < 0) throw new Error(`Block ${selector} fehlt`);
	const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
	const out = new Map<string, string>();
	for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
	return out;
}

const ROOT = block(':root');
const DARK = block('.dark');

/** sRGB ↔ OKLab (für `color-mix(in oklab, …)`) */
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function toOklab([r, g, b]: RgbTuple): [number, number, number] {
	const [R, G, B] = [lin(r / 255), lin(g / 255), lin(b / 255)];
	const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
	const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
	const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}
function fromOklab([L, a, b]: [number, number, number]): RgbTuple {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const rgb = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	];
	return rgb.map((v) => Math.round(Math.min(1, Math.max(0, gam(v))) * 255)) as RgbTuple;
}

type Theme = 'light' | 'dark';

/** Wert eines Tokens im Thema (dunkel erbt aus `:root`, was `.dark` nicht überschreibt) */
function raw(name: string, theme: Theme): string {
	const v = (theme === 'dark' ? DARK.get(name) : undefined) ?? ROOT.get(name);
	if (v === undefined) throw new Error(`Token ${name} fehlt (${theme})`);
	return v;
}

/** Farbausdruck → sRGB; `transparent`-Anteile werden über `surface` gelegt */
function evaluate(expr: string, theme: Theme, surface?: RgbTuple): RgbTuple {
	const e = expr.trim();
	const v = /^var\((--[a-z0-9-]+)(?:\s*,\s*(.+))?\)$/.exec(e);
	if (v) {
		if (v[1] === '--accent-color') return evaluate(v[2] ?? '#2563eb', theme, surface);
		return evaluate(raw(v[1]!, theme), theme, surface);
	}
	if (e === 'white') return [255, 255, 255];
	if (e === 'black') return [0, 0, 0];
	const mix = /^color-mix\(in oklab,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/.exec(e);
	if (mix) {
		const a = evaluate(mix[1]!, theme, surface);
		const p = Number(mix[2]) / 100;
		if (mix[3]!.trim() === 'transparent') {
			if (!surface) throw new Error(`Für ${e} fehlt die Fläche`);
			// halbtransparente Farbe über der Fläche (Browser mischen beim Überlagern in sRGB)
			return a.map((c, i) => Math.round(c * p + surface[i]! * (1 - p))) as RgbTuple;
		}
		const b = evaluate(mix[3]!, theme, surface);
		const [la, lb] = [toOklab(a), toOklab(b)];
		return fromOklab(
			[0, 1, 2].map((i) => la[i]! * p + lb[i]! * (1 - p)) as [number, number, number]
		);
	}
	const c = parseColor(e);
	if (!c) throw new Error(`Farbe nicht lesbar: ${e}`);
	return c;
}

const token = (name: string, theme: Theme, surface?: RgbTuple) =>
	evaluate(`var(${name})`, theme, surface);

/** Getönte Statusfläche wie `bg-<status>-muted` (Anteil aus `--status-muted`) über einer Fläche */
function tint(status: string, theme: Theme, surface: RgbTuple): RgbTuple {
	const pct = raw('--status-muted', theme);
	return evaluate(`color-mix(in oklab, var(--${status}) ${pct}, transparent)`, theme, surface);
}

const THEMES: Theme[] = ['light', 'dark'];
const SURFACES = ['--background', '--card', '--muted'];
const AA = 4.5;

describe('Design-Tokens: Kontrast (WCAG AA)', () => {
	for (const theme of THEMES) {
		describe(theme === 'light' ? 'hell' : 'dunkel', () => {
			const pairs: [string, string][] = [
				['--foreground', '--background'],
				['--card-foreground', '--card'],
				['--popover-foreground', '--popover'],
				['--secondary-foreground', '--secondary'],
				['--accent-foreground', '--accent'],
				['--muted-foreground', '--background'],
				['--muted-foreground', '--card'],
				['--muted-foreground', '--muted'],
				['--link', '--background'],
				['--link', '--card'],
				['--destructive-foreground', '--destructive'],
				['--success-foreground', '--success'],
				['--warning-foreground', '--warning'],
				['--info-foreground', '--info']
			];
			it.each(pairs)('%s auf %s ≥ 4,5 : 1', (fg, bg) => {
				expect(contrastRatio(token(fg, theme), token(bg, theme))).toBeGreaterThanOrEqual(AA);
			});

			for (const status of ['destructive', 'success', 'warning', 'info']) {
				it.each(SURFACES)(`--${status} als Text auf %s`, (surface) => {
					const fg = token(`--${status}`, theme);
					expect(contrastRatio(fg, token(surface, theme))).toBeGreaterThanOrEqual(AA);
				});
				// Getönte Fläche (`bg-<status>-muted`, Alert/Badge) liegt auf Hintergrund oder Karte
				it.each(['--background', '--card'])(
					`--${status} als Text auf getönter Fläche über %s`,
					(surface) => {
						const fg = token(`--${status}`, theme);
						const s = token(surface, theme);
						expect(contrastRatio(fg, tint(status, theme, s))).toBeGreaterThanOrEqual(AA);
					}
				);
			}

			// Dateitypen (Modul Dateien): Kürzel als Text auf Karte/Fläche und auf der getönten Typfläche
			for (const kind of ['pdf', 'word', 'sheet', 'slides', 'image', 'archive', 'media', 'code']) {
				it.each(SURFACES)(`--file-${kind} als Text auf %s`, (surface) => {
					const fg = token(`--file-${kind}`, theme);
					expect(contrastRatio(fg, token(surface, theme))).toBeGreaterThanOrEqual(AA);
				});
				it(`--file-${kind} auf getönter Fläche über --card`, () => {
					const fg = token(`--file-${kind}`, theme);
					expect(
						contrastRatio(fg, tint(`file-${kind}`, theme, token('--card', theme)))
					).toBeGreaterThanOrEqual(AA);
				});
			}

			it('Standard-Akzent: berechneter Vordergrund auf --primary ≥ 4,5 : 1', () => {
				const primary = token('--primary', theme);
				const fg = parseColor(primaryForeground('#2563eb'))!;
				expect(contrastRatio(fg, primary)).toBeGreaterThanOrEqual(AA);
			});

			it('color-scheme ist gesetzt', () => {
				expect((theme === 'dark' ? DARK : ROOT).size).toBeGreaterThan(0);
				const body = css.slice(css.indexOf(theme === 'dark' ? '\n.dark {' : '\n:root {'));
				expect(body.slice(0, body.indexOf('\n}'))).toContain(`color-scheme: ${theme};`);
			});
		});
	}
});

describe('Akzentfarbe: Vordergrund nach Kontrast (#54)', () => {
	const light = parseColor(PRIMARY_FOREGROUND_LIGHT)!;
	const dark = parseColor(PRIMARY_FOREGROUND_DARK)!;

	it('app.css nutzt dieselbe Schwelle und dieselben Farben wie primaryForeground()', () => {
		const rule = css.slice(css.indexOf('--primary-foreground: color('));
		const expr = rule.slice(0, rule.indexOf(';'));
		expect(expr).toContain(`(${PRIMARY_FOREGROUND_THRESHOLD} - (0.2126 * pow(r, 2.2)`);
		expect(expr.match(/clamp\(\s*0\.04,/g)).toHaveLength(3);
		expect(expr.match(/0\.98\s*\)/g)).toHaveLength(3);
		// 0.04 / 0.98 in sRGB = #0a0a0a / #fafafa
		expect(Math.round(0.04 * 255)).toBe(dark[0]);
		expect(Math.round(0.98 * 255)).toBe(light[0]);
	});

	it.each([
		['#facc15', PRIMARY_FOREGROUND_DARK], // Gelb aus dem Issue
		['#2563eb', PRIMARY_FOREGROUND_LIGHT], // Standard
		['#000000', PRIMARY_FOREGROUND_LIGHT],
		['#ffffff', PRIMARY_FOREGROUND_DARK],
		['#16a34a', PRIMARY_FOREGROUND_DARK],
		['#7c3aed', PRIMARY_FOREGROUND_LIGHT],
		['kaputt', PRIMARY_FOREGROUND_LIGHT]
	])('%s → %s', (accent, expected) => {
		expect(primaryForeground(accent)).toBe(expected);
	});

	it('#facc15 ergibt lesbare Primärknöpfe (≥ 4,5 : 1)', () => {
		expect(
			contrastRatio(parseColor(primaryForeground('#facc15'))!, parseColor('#facc15')!)
		).toBeGreaterThan(AA);
	});

	it('wählt für keine Farbe die schlechtere Textfarbe, wenn nur die bessere AA erreicht', () => {
		let worst = Infinity;
		for (let r = 0; r < 256; r += 15)
			for (let g = 0; g < 256; g += 15)
				for (let b = 0; b < 256; b += 15) {
					const bg: RgbTuple = [r, g, b];
					const hex = `#${bg.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
					const chosen = contrastRatio(parseColor(primaryForeground(hex))!, bg);
					const best = Math.max(contrastRatio(light, bg), contrastRatio(dark, bg));
					if (best >= AA) expect(chosen, hex).toBeGreaterThanOrEqual(AA);
					worst = Math.min(worst, chosen);
				}
		// Mittlere Töne erreichen mit keiner der beiden Farben ganz 4,5 : 1 – Untergrenze festhalten
		expect(worst).toBeGreaterThan(4.2);
	});
});
