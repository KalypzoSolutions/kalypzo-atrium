/**
 * Icon-Bibliothek (alle Lucide-Icons) für Browser und Server: Daten werden erst bei Bedarf geladen
 * (`loadIconSet`, eigener Chunk), Suche über englische Namen und deutsche Begriffe.
 * Daten: `lucide-icons.json`, erzeugt mit `node scripts/generate-icon-data.mjs`.
 */
import { getLocale } from '$lib/i18n';
import { ICON_KEYWORDS_DE } from './keywords-de';

export { ICON_KEYWORDS_DE, ICON_SUGGESTIONS } from './keywords-de';

/** SVG-Kindelemente eines Icons (24×24, Strich-Grafik) */
export type IconNode = [tag: string, attrs: Record<string, string | number>][];

export interface IconSet {
	/** Lucide-Version der Daten */
	version: string;
	/** Alle Namen, alphabetisch */
	names: string[];
	get(name: string): IconNode | undefined;
	has(name: string): boolean;
}

/** Format eines Icon-Namens (`tree-pine`); ob es das Icon gibt, sagt `IconSet.has` */
export const ICON_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_ICON_NAME = 64;

let pending: Promise<IconSet> | null = null;

/** Lädt die Icon-Daten einmal je Laufzeit (danach aus dem Zwischenspeicher) */
export function loadIconSet(): Promise<IconSet> {
	pending ??= import('./lucide-icons.json')
		.then((mod) => {
			// JSON-Typ ist riesig und zu eng (Tupel) – bewusst als bekannte Form lesen
			const data = (mod.default ?? mod) as unknown as {
				version: string;
				icons: Record<string, IconNode>;
			};
			const map = new Map(Object.entries(data.icons));
			return {
				version: data.version,
				names: [...map.keys()].sort(),
				get: (name: string) => map.get(name),
				has: (name: string) => map.has(name)
			} satisfies IconSet;
		})
		.catch((e: unknown) => {
			pending = null; // nächster Versuch lädt neu (z. B. nach Netzwerkfehler)
			throw e;
		});
	return pending;
}

/** Kleinschreibung, Umlaute/ß gefaltet, Bindestriche als Leerzeichen */
export function foldIconText(s: string): string {
	return s
		.toLowerCase()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.replace(/-/g, ' ')
		.trim();
}

/** Suchtexte je Icon (Name + deutsche Begriffe), einmal berechnet */
const haystacks = new Map<string, string[]>();
function haystackOf(name: string): string[] {
	let h = haystacks.get(name);
	if (!h) {
		h = [foldIconText(name), ...(ICON_KEYWORDS_DE[name] ?? []).map(foldIconText)];
		haystacks.set(name, h);
	}
	return h;
}

/**
 * Icons zu einer Suche, beste Treffer zuerst: alle Wörter müssen vorkommen (in Name oder deutschem Begriff);
 * Rang: Name exakt < Begriff exakt < Wortanfang < irgendwo enthalten, dann alphabetisch.
 */
export function searchIcons(set: IconSet, query: string, limit = Infinity): string[] {
	const words = foldIconText(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return set.names.slice(0, limit);
	const full = words.join(' ');
	const scored: { name: string; score: number }[] = [];
	for (const name of set.names) {
		const hay = haystackOf(name);
		if (!words.every((w) => hay.some((h) => h.includes(w)))) continue;
		let score = 4;
		if (hay[0] === full) score = 0;
		else if (hay.slice(1).includes(full)) score = 1;
		else if (hay.some((h) => h.startsWith(full) || h.split(' ').some((p) => p.startsWith(full))))
			score = 2;
		else if (hay.some((h) => h.includes(full))) score = 3;
		scored.push({ name, score });
	}
	scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
	return scored.slice(0, limit).map((s) => s.name);
}

/** Lesbare Bezeichnung: auf Deutsch der erste deutsche Begriff (groß geschrieben), sonst der Name */
export function iconLabel(name: string): string {
	const de = getLocale() === 'de' ? ICON_KEYWORDS_DE[name]?.[0] : undefined;
	if (de) return de.charAt(0).toUpperCase() + de.slice(1);
	return name.replace(/-/g, ' ');
}
