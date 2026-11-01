/**
 * Kleines Nachrichtenformat (Teilmenge von ICU MessageFormat), ohne Abhängigkeiten:
 *
 * - Platzhalter `{name}`
 * - Mehrzahl `{count, plural, =0 {keine} one {# Eintrag} other {# Einträge}}` (`#` = Zahl, Regeln aus `Intl.PluralRules`)
 * - Auswahl `{art, select, user {Konto} group {Gruppe} other {Eintrag}}`
 *
 * Unbekannte Platzhalter bleiben als `{name}` stehen (fällt in Tests auf, statt still zu verschwinden).
 */

export type MessageParams = Record<string, string | number | null | undefined>;

const pluralCache = new Map<string, Intl.PluralRules>();

function pluralRules(locale: string): Intl.PluralRules {
	let r = pluralCache.get(locale);
	if (!r) {
		r = new Intl.PluralRules(locale);
		pluralCache.set(locale, r);
	}
	return r;
}

/** Liest ab `start` (direkt nach `{`) bis zur passenden `}`; liefert Inhalt und Index nach der Klammer. */
function readBlock(src: string, start: number): { body: string; end: number } | null {
	let depth = 1;
	for (let i = start; i < src.length; i++) {
		const c = src[i];
		if (c === '{') depth++;
		else if (c === '}') {
			depth--;
			if (depth === 0) return { body: src.slice(start, i), end: i + 1 };
		}
	}
	return null;
}

/** Zerlegt `=0 {…} one {…} other {…}` in Fälle. */
function parseCases(src: string): Map<string, string> {
	const cases = new Map<string, string>();
	let i = 0;
	while (i < src.length) {
		while (i < src.length && /\s/.test(src[i]!)) i++;
		let key = '';
		while (i < src.length && !/[\s{]/.test(src[i]!)) key += src[i++];
		while (i < src.length && /\s/.test(src[i]!)) i++;
		if (src[i] !== '{' || !key) break;
		const block = readBlock(src, i + 1);
		if (!block) break;
		cases.set(key, block.body);
		i = block.end;
	}
	return cases;
}

function formatNumber(n: number, locale: string): string {
	return new Intl.NumberFormat(locale).format(n);
}

export function formatMessage(
	template: string,
	params: MessageParams | undefined,
	locale: string
): string {
	if (!template.includes('{')) return template;
	let out = '';
	let i = 0;
	while (i < template.length) {
		const c = template[i]!;
		if (c !== '{') {
			out += c;
			i++;
			continue;
		}
		const block = readBlock(template, i + 1);
		if (!block) {
			out += template.slice(i);
			break;
		}
		out += formatArgument(block.body, params, locale);
		i = block.end;
	}
	return out;
}

function formatArgument(body: string, params: MessageParams | undefined, locale: string): string {
	const first = body.indexOf(',');
	if (first < 0) {
		const name = body.trim();
		const v = params?.[name];
		if (v === undefined || v === null) return `{${name}}`;
		return typeof v === 'number' ? formatNumber(v, locale) : v;
	}
	const name = body.slice(0, first).trim();
	const rest = body.slice(first + 1);
	const second = rest.indexOf(',');
	const kind = (second < 0 ? rest : rest.slice(0, second)).trim();
	const cases = parseCases(second < 0 ? '' : rest.slice(second + 1));
	const v = params?.[name];
	if (kind === 'plural') {
		const n = Number(v ?? 0);
		const exact = cases.get(`=${n}`);
		const chosen = exact ?? cases.get(pluralRules(locale).select(n)) ?? cases.get('other') ?? '';
		return formatMessage(chosen.replaceAll('#', formatNumber(n, locale)), params, locale);
	}
	if (kind === 'select') {
		const chosen = cases.get(String(v ?? '')) ?? cases.get('other') ?? '';
		return formatMessage(chosen, params, locale);
	}
	return `{${body}}`;
}

/** Namen aller Platzhalter einer Nachricht (für den Abgleich de ↔ en). */
export function messageArguments(template: string): string[] {
	const names = new Set<string>();
	const walk = (src: string) => {
		let i = 0;
		while (i < src.length) {
			if (src[i] !== '{') {
				i++;
				continue;
			}
			const block = readBlock(src, i + 1);
			if (!block) return;
			const body = block.body;
			const comma = body.indexOf(',');
			names.add((comma < 0 ? body : body.slice(0, comma)).trim());
			if (comma >= 0) {
				const rest = body.slice(comma + 1);
				const second = rest.indexOf(',');
				if (second >= 0) for (const v of parseCases(rest.slice(second + 1)).values()) walk(v);
			}
			i = block.end;
		}
	};
	walk(template);
	return [...names].sort();
}
