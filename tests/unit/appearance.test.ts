import { describe, expect, it } from 'vitest';
import {
	activeThemeSchema,
	blankTheme,
	cssBackground,
	darkenColor,
	deriveDark,
	isReadable,
	parseFavorites,
	parseUserThemes,
	resolveTheme,
	styleString,
	textContrast,
	themeFavoritesSchema,
	themeCssVars,
	THEME_PRESETS,
	THEMES_MAX,
	userThemeSchema,
	userThemesSchema,
	type ThemeMode
} from '$lib/appearance';
import { parseHex, relativeLuminance } from '$lib/components/ui/color-picker/contrast';
import {
	addSpot,
	addStop,
	colorAt,
	convertBackground,
	moveStop,
	removeStop
} from '$lib/components/ui/gradient-editor/gradient';

const id = () => crypto.randomUUID();

describe('Theme-Schema', () => {
	it('akzeptiert ein neues Theme und normalisiert Farben klein', () => {
		const t = blankTheme(id());
		const r = userThemeSchema.parse({ ...t, accent: '#AABBCC' });
		expect(r.accent).toBe('#aabbcc');
	});

	it('Grenzen für Farbpunkte (2–6), Flecken (1–5) und Abdeckung', () => {
		const base = blankTheme(id());
		const withStops = (n: number) => ({
			...base,
			light: {
				...base.light,
				background: {
					kind: 'linear',
					angle: 0,
					stops: Array.from({ length: n }, (_, i) => ({ color: '#ffffff', pos: i }))
				}
			}
		});
		expect(userThemeSchema.safeParse(withStops(1)).success).toBe(false);
		expect(userThemeSchema.safeParse(withStops(2)).success).toBe(true);
		expect(userThemeSchema.safeParse(withStops(6)).success).toBe(true);
		expect(userThemeSchema.safeParse(withStops(7)).success).toBe(false);
		const mesh = (n: number) => ({
			...base,
			light: {
				...base.light,
				background: {
					kind: 'mesh',
					base: '#ffffff',
					spots: Array.from({ length: n }, () => ({ color: '#000000', x: 0, y: 0, size: 50 }))
				}
			}
		});
		expect(userThemeSchema.safeParse(mesh(0)).success).toBe(false);
		expect(userThemeSchema.safeParse(mesh(5)).success).toBe(true);
		expect(userThemeSchema.safeParse(mesh(6)).success).toBe(false);
		expect(userThemeSchema.safeParse({ ...base, light: { ...base.light, veil: 91 } }).success).toBe(
			false
		);
	});

	it('lehnt eingeschleustes CSS, leere Namen und doppelte IDs ab', () => {
		const t = blankTheme(id());
		for (const color of ['red', '#fff', '#ffffff;}', 'url(x)', '#12345g']) {
			const bad = { ...t, light: { ...t.light, background: { kind: 'solid', color } } };
			expect(userThemeSchema.safeParse(bad).success).toBe(false);
		}
		expect(userThemeSchema.safeParse({ ...t, name: '   ' }).success).toBe(false);
		expect(userThemeSchema.safeParse({ ...t, name: 'x'.repeat(41) }).success).toBe(false);
		expect(userThemesSchema.safeParse([t, t]).success).toBe(false);
		const many = Array.from({ length: THEMES_MAX + 1 }, () => blankTheme(id()));
		expect(userThemesSchema.safeParse(many).success).toBe(false);
	});

	it('aktive Auswahl: leer, UUID oder Vorschlag', () => {
		expect(activeThemeSchema.safeParse('').success).toBe(true);
		expect(activeThemeSchema.safeParse(id()).success).toBe(true);
		expect(activeThemeSchema.safeParse('preset:wald').success).toBe(true);
		expect(activeThemeSchema.safeParse('preset:../x').success).toBe(false);
		expect(activeThemeSchema.safeParse('abc').success).toBe(false);
	});

	it('Favoriten: nur Theme-IDs, eindeutig, höchstens 30', () => {
		const a = id();
		expect(themeFavoritesSchema.safeParse([a, 'preset:wald']).success).toBe(true);
		expect(themeFavoritesSchema.safeParse(['']).success).toBe(false);
		expect(themeFavoritesSchema.safeParse([a, a]).success).toBe(false);
		expect(themeFavoritesSchema.safeParse(['x']).success).toBe(false);
		expect(themeFavoritesSchema.safeParse(Array.from({ length: 31 }, () => id())).success).toBe(
			false
		);
		expect(parseFavorites([a, a, '', 'kaputt', 'preset:ozean', 3])).toEqual([a, 'preset:ozean']);
		expect(parseFavorites(null)).toEqual([]);
	});

	it('parseUserThemes verwirft kaputte Einträge statt alles', () => {
		const ok = blankTheme(id());
		expect(parseUserThemes([ok, { id: 'x' }, null, ok])).toEqual([ok]);
		expect(parseUserThemes('kaputt')).toEqual([]);
	});

	it('resolveTheme findet Vorschläge und eigene Themes', () => {
		const own = blankTheme(id());
		expect(resolveTheme('', [own])).toBeNull();
		expect(resolveTheme(own.id, [own])).toBe(own);
		expect(resolveTheme('preset:wald', [])?.name).toBe('Wald');
		expect(resolveTheme('preset:gibtsnicht', [])).toBeNull();
		expect(resolveTheme(id(), [own])).toBeNull();
	});
});

describe('Theme → CSS', () => {
	it('erzeugt je Art den passenden Hintergrund', () => {
		expect(cssBackground({ kind: 'solid', color: '#112233' })).toBe(
			'linear-gradient(#112233, #112233)'
		);
		expect(
			cssBackground({
				kind: 'linear',
				angle: 90,
				stops: [
					{ color: '#000000', pos: 100 },
					{ color: '#ffffff', pos: 0 }
				]
			})
		).toBe('linear-gradient(90deg, #ffffff 0%, #000000 100%)');
		expect(
			cssBackground({
				kind: 'radial',
				at: 'top-left',
				stops: [
					{ color: '#000000', pos: 0 },
					{ color: '#ffffff', pos: 100 }
				]
			})
		).toBe('radial-gradient(at top left, #000000 0%, #ffffff 100%)');
		expect(
			cssBackground({
				kind: 'mesh',
				base: '#eeeeee',
				spots: [{ color: '#ff0000', x: 10, y: 20, size: 50 }]
			})
		).toBe(
			'radial-gradient(circle at 10% 20%, #ff0000 0%, #ff000000 50%), linear-gradient(#eeeeee, #eeeeee)'
		);
	});

	it('themeCssVars liefert alle sechs Variablen ohne Anführungszeichen', () => {
		const vars = themeCssVars(THEME_PRESETS[0]!);
		expect(Object.keys(vars)).toHaveLength(6);
		const style = styleString(vars);
		expect(style).not.toMatch(/["<>]/);
		expect(style).toContain('--app-veil-light:25%');
	});

	it('deriveDark dunkelt Farben ab und halbiert die Abdeckung', () => {
		const light: ThemeMode = {
			background: { kind: 'solid', color: '#fef3c7' },
			veil: 40,
			sidebar: 'glass'
		};
		const dark = deriveDark(light);
		expect(dark.veil).toBe(20);
		const c = dark.background.kind === 'solid' ? dark.background.color : '';
		expect(relativeLuminance(parseHex(c)!)).toBeLessThan(0.05);
		expect(darkenColor('kaputt')).toBe('kaputt');
	});

	it('Kontrast: höhere Abdeckung macht schwierige Hintergründe lesbar', () => {
		const loud: ThemeMode = {
			background: { kind: 'solid', color: '#2563eb' },
			veil: 0,
			sidebar: 'glass'
		};
		expect(isReadable(loud, 'light')).toBe(false);
		expect(isReadable({ ...loud, veil: 85 }, 'light')).toBe(true);
		expect(textContrast({ ...loud, veil: 85 }, 'light').text).toBeGreaterThan(
			textContrast(loud, 'light').text
		);
	});
});

describe('Vorschläge', () => {
	it('sind gültig, eindeutig und haben das Präfix preset:', () => {
		const ids = new Set<string>();
		for (const t of THEME_PRESETS) {
			expect(t.id).toMatch(/^preset:[a-z0-9-]+$/);
			expect(ids.has(t.id)).toBe(false);
			ids.add(t.id);
			expect(userThemeSchema.safeParse({ ...t, id: id() }).success, t.name).toBe(true);
		}
		expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(8);
	});

	it('Text ist hell und dunkel lesbar (Text ≥ 4,5 : 1, gedämpft ≥ 3 : 1)', () => {
		for (const t of THEME_PRESETS) {
			for (const scheme of ['light', 'dark'] as const) {
				const c = textContrast(t[scheme], scheme);
				expect(c.text, `${t.name} ${scheme}`).toBeGreaterThanOrEqual(4.5);
				expect(c.muted, `${t.name} ${scheme} gedämpft`).toBeGreaterThanOrEqual(3);
			}
		}
	});
});

describe('Verlaufseditor-Hilfen', () => {
	const stops = [
		{ color: '#000000', pos: 0 },
		{ color: '#ffffff', pos: 100 }
	];

	it('colorAt interpoliert und klemmt', () => {
		expect(colorAt(stops, 50)).toBe('#808080');
		expect(colorAt(stops, -10)).toBe('#000000');
		expect(colorAt(stops, 200)).toBe('#ffffff');
	});

	it('addStop/removeStop/moveStop halten die Grenzen ein', () => {
		const added = addStop(stops, 50);
		expect(added.index).toBe(2);
		expect(added.stops[2]).toEqual({ color: '#808080', pos: 50 });
		let full = stops;
		for (let i = 0; i < 10; i++) full = addStop(full, i * 10).stops;
		expect(full).toHaveLength(6);
		expect(addStop(full, 5).index).toBe(-1);
		expect(removeStop(stops, 0)).toBe(stops);
		expect(removeStop(added.stops, 2)).toHaveLength(2);
		expect(moveStop(stops, 1, 150)[1]!.pos).toBe(100);
		expect(moveStop(stops, 0, Number.NaN)[0]!.pos).toBe(0);
	});

	it('convertBackground übernimmt Farben zwischen den Arten', () => {
		const lin = convertBackground({ kind: 'solid', color: '#123456' }, 'linear');
		expect(lin.kind === 'linear' && lin.stops[0]!.color).toBe('#123456');
		const mesh = convertBackground(
			{ kind: 'linear', angle: 0, stops: [...stops, { color: '#ff0000', pos: 50 }] },
			'mesh'
		);
		expect(mesh.kind === 'mesh' && mesh.base).toBe('#000000');
		expect(mesh.kind === 'mesh' && mesh.spots.map((s) => s.color)).toEqual(['#ffffff', '#ff0000']);
		const back = convertBackground(mesh, 'radial');
		expect(back.kind === 'radial' && back.stops.length).toBe(3);
		const solid = convertBackground(mesh, 'solid');
		expect(solid).toEqual({ kind: 'solid', color: '#000000' });
		for (const bg of [lin, mesh, back, solid]) {
			expect(
				userThemeSchema.safeParse({
					...blankTheme(id()),
					light: { background: bg, veil: 0, sidebar: 'glass' }
				}).success
			).toBe(true);
		}
	});

	it('addSpot höchstens fünf Flecken', () => {
		let spots = [{ color: '#000000', x: 0, y: 0, size: 50 }];
		for (let i = 0; i < 10; i++) spots = addSpot(spots);
		expect(spots).toHaveLength(5);
	});
});
