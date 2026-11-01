import { t } from '$lib/i18n';
/**
 * Vorschläge (fest im Code, ID `preset:<slug>`). Jede Person kann einen Vorschlag direkt nutzen oder als
 * eigenes Theme kopieren und anpassen. Lesbarkeit prüft `tests/unit/appearance-presets.test.ts`.
 */
import { PRESET_PREFIX, type UserTheme } from './schema';

/** Vorschlag; der Name wird erst beim Lesen übersetzt (Sprache des Requests bzw. der Seite). */
const p = (slug: string, theme: Omit<UserTheme, 'id' | 'name'>): UserTheme => {
	const out = { id: `${PRESET_PREFIX}${slug}`, name: '', ...theme };
	Object.defineProperty(out, 'name', {
		get: () => t(`appearance.presets.${slug}`),
		enumerable: true
	});
	return out;
};

export const THEME_PRESETS: readonly UserTheme[] = [
	p('wald', {
		accent: '#15803d',
		light: {
			background: {
				kind: 'linear',
				angle: 160,
				stops: [
					{ color: '#ecfccb', pos: 0 },
					{ color: '#d1fae5', pos: 55 },
					{ color: '#a7f3d0', pos: 100 }
				]
			},
			veil: 25,
			sidebar: 'glass'
		},
		dark: {
			background: {
				kind: 'linear',
				angle: 160,
				stops: [
					{ color: '#1a2e05', pos: 0 },
					{ color: '#052e16', pos: 60 },
					{ color: '#022c22', pos: 100 }
				]
			},
			veil: 10,
			sidebar: 'glass'
		}
	}),
	p('ozean', {
		accent: '#0369a1',
		light: {
			background: {
				kind: 'linear',
				angle: 180,
				stops: [
					{ color: '#f0f9ff', pos: 0 },
					{ color: '#bae6fd', pos: 60 },
					{ color: '#a5f3fc', pos: 100 }
				]
			},
			veil: 25,
			sidebar: 'glass'
		},
		dark: {
			background: {
				kind: 'linear',
				angle: 180,
				stops: [
					{ color: '#082f49', pos: 0 },
					{ color: '#0c1e3a', pos: 60 },
					{ color: '#042f2e', pos: 100 }
				]
			},
			veil: 10,
			sidebar: 'glass'
		}
	}),
	p('nordlicht', {
		accent: '#0f766e',
		light: {
			background: {
				kind: 'mesh',
				base: '#f0fdfa',
				spots: [
					{ color: '#99f6e4', x: 10, y: 10, size: 55 },
					{ color: '#c4b5fd', x: 90, y: 20, size: 50 },
					{ color: '#a7f3d0', x: 60, y: 95, size: 60 }
				]
			},
			veil: 25,
			sidebar: 'glass'
		},
		dark: {
			background: {
				kind: 'mesh',
				base: '#0b1120',
				spots: [
					{ color: '#134e4a', x: 10, y: 10, size: 60 },
					{ color: '#3b0764', x: 90, y: 20, size: 55 },
					{ color: '#064e3b', x: 60, y: 95, size: 60 }
				]
			},
			veil: 5,
			sidebar: 'glass'
		}
	}),
	p('lagerfeuer', {
		accent: '#c2410c',
		light: {
			background: {
				kind: 'radial',
				at: 'bottom',
				stops: [
					{ color: '#fed7aa', pos: 0 },
					{ color: '#fef3c7', pos: 55 },
					{ color: '#fffbeb', pos: 100 }
				]
			},
			veil: 20,
			sidebar: 'tinted'
		},
		dark: {
			background: {
				kind: 'radial',
				at: 'bottom',
				stops: [
					{ color: '#431407', pos: 0 },
					{ color: '#1c1917', pos: 60 },
					{ color: '#0c0a09', pos: 100 }
				]
			},
			veil: 0,
			sidebar: 'tinted'
		}
	}),
	p('sonnenuntergang', {
		accent: '#be185d',
		light: {
			background: {
				kind: 'linear',
				angle: 135,
				stops: [
					{ color: '#fef3c7', pos: 0 },
					{ color: '#fecdd3', pos: 50 },
					{ color: '#e9d5ff', pos: 100 }
				]
			},
			veil: 25,
			sidebar: 'glass'
		},
		dark: {
			background: {
				kind: 'linear',
				angle: 135,
				stops: [
					{ color: '#422006', pos: 0 },
					{ color: '#4c0519', pos: 50 },
					{ color: '#2e1065', pos: 100 }
				]
			},
			veil: 15,
			sidebar: 'glass'
		}
	}),
	p('lavendel', {
		accent: '#7c3aed',
		light: {
			background: {
				kind: 'linear',
				angle: 200,
				stops: [
					{ color: '#f5f3ff', pos: 0 },
					{ color: '#e9d5ff', pos: 100 }
				]
			},
			veil: 15,
			sidebar: 'tinted'
		},
		dark: {
			background: {
				kind: 'linear',
				angle: 200,
				stops: [
					{ color: '#1e1b4b', pos: 0 },
					{ color: '#2e1065', pos: 100 }
				]
			},
			veil: 15,
			sidebar: 'tinted'
		}
	}),
	p('bergsee', {
		accent: '#0891b2',
		light: {
			background: {
				kind: 'mesh',
				base: '#f8fafc',
				spots: [
					{ color: '#bae6fd', x: 0, y: 0, size: 60 },
					{ color: '#d9f99d', x: 100, y: 100, size: 55 },
					{ color: '#e0e7ff', x: 100, y: 0, size: 45 }
				]
			},
			veil: 20,
			sidebar: 'glass'
		},
		dark: {
			background: {
				kind: 'mesh',
				base: '#0f172a',
				spots: [
					{ color: '#0c4a6e', x: 0, y: 0, size: 60 },
					{ color: '#1a2e05', x: 100, y: 100, size: 55 },
					{ color: '#1e1b4b', x: 100, y: 0, size: 45 }
				]
			},
			veil: 5,
			sidebar: 'glass'
		}
	}),
	p('sand', {
		accent: '#a16207',
		light: {
			background: {
				kind: 'linear',
				angle: 180,
				stops: [
					{ color: '#fafaf9', pos: 0 },
					{ color: '#f5f0e6', pos: 100 }
				]
			},
			veil: 0,
			sidebar: 'tinted'
		},
		dark: {
			background: {
				kind: 'linear',
				angle: 180,
				stops: [
					{ color: '#1c1917', pos: 0 },
					{ color: '#292524', pos: 100 }
				]
			},
			veil: 0,
			sidebar: 'tinted'
		}
	}),
	p('schiefer', {
		accent: '#475569',
		light: {
			background: { kind: 'solid', color: '#f1f5f9' },
			veil: 0,
			sidebar: 'solid'
		},
		dark: {
			background: { kind: 'solid', color: '#0f172a' },
			veil: 0,
			sidebar: 'solid'
		}
	}),
	p('morgenrot', {
		accent: '#e11d48',
		light: {
			background: {
				kind: 'radial',
				at: 'top-right',
				stops: [
					{ color: '#fecdd3', pos: 0 },
					{ color: '#ffedd5', pos: 45 },
					{ color: '#ffffff', pos: 100 }
				]
			},
			veil: 15,
			sidebar: 'glass'
		},
		dark: {
			background: {
				kind: 'radial',
				at: 'top-right',
				stops: [
					{ color: '#4c0519', pos: 0 },
					{ color: '#1c1917', pos: 55 },
					{ color: '#0a0a0a', pos: 100 }
				]
			},
			veil: 0,
			sidebar: 'glass'
		}
	})
];

export function findPreset(id: string): UserTheme | null {
	return THEME_PRESETS.find((t) => t.id === id) ?? null;
}

/** Aktives Theme aus Auswahl-ID und eigener Liste (unbekannt → `null`) */
export function resolveTheme(activeId: string, own: UserTheme[]): UserTheme | null {
	if (!activeId) return null;
	if (activeId.startsWith(PRESET_PREFIX)) return findPreset(activeId);
	return own.find((t) => t.id === activeId) ?? null;
}
