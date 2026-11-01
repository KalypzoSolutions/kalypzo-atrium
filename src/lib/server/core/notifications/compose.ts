/**
 * Texte für Benachrichtigungs-Mails und Push-Nachrichten (rein, ohne Datenbank). Der Rahmen (Anrede,
 * Sammelbetreff, Hinweis auf die Einstellungen) entsteht in der Sprache der empfangenden Person (`locale`);
 * Titel und Text der Einträge liefern die Module selbst.
 */
import { getLocale, tl, type Locale } from '$lib/i18n';
import type { PushPayload } from './push';

export interface ComposeItem {
	title: string;
	body: string;
	link: string | null;
	group: string | null;
	tag: string;
	/** Kürzerer Text nur für Push (sonst `body`) */
	pushBody?: string | null;
}

/** Push-Text: kurz halten (Sperrbildschirm), Zeilenumbrüche zu Leerzeichen */
export const PUSH_BODY_MAX = 240;
/** Mehr Einzel-Pushs je Person und Aufruf werden zu einer Sammelnachricht */
export const PUSH_ITEMS_MAX = 3;

export function oneLine(value: string, max: number): string {
	const s = value.replace(/\s+/g, ' ').trim();
	return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function absolute(origin: string, link: string | null): string | null {
	return link ? `${origin}${link}` : null;
}

/** Mail mit einer oder mehreren Benachrichtigungen (nach `group` geordnet) */
export function composeMail(
	name: string,
	items: ComposeItem[],
	kind: 'immediate' | 'daily',
	origin: string,
	locale: Locale = getLocale()
): { subject: string; text: string } {
	const n = items.length;
	const subject =
		kind === 'daily'
			? tl(locale, 'notifications.digestSubject', { count: n })
			: n === 1
				? items[0]!.title
				: tl(locale, 'notifications.newSubject', { count: n });
	const parts: string[] = [tl(locale, 'notifications.greeting', { name })];
	if (kind === 'daily') parts.push(tl(locale, 'notifications.digestIntro'));
	else if (n > 1) parts.push(tl(locale, 'notifications.newIntro', { count: n }));

	const groups = [...new Set(items.map((i) => i.group))];
	for (const g of groups) {
		if (g && (groups.length > 1 || n > 1)) parts.push(`– ${g} –`);
		for (const i of items.filter((x) => x.group === g)) {
			const lines = n === 1 && kind === 'immediate' ? [] : [i.title];
			if (i.body) lines.push(i.body);
			const url = absolute(origin, i.link);
			if (url) lines.push(url);
			if (lines.length) parts.push(lines.join('\n'));
		}
	}
	parts.push(
		tl(locale, 'notifications.settingsHint', { url: `${origin}/profile?tab=notifications` })
	);
	return { subject: oneLine(subject, 200), text: parts.join('\n\n') };
}

/** Push-Nachrichten einer Person: einzeln oder (zu viele) als Sammelnachricht */
export function composePush(
	items: ComposeItem[],
	kind: 'immediate' | 'daily',
	locale: Locale = getLocale()
): PushPayload[] {
	if (!items.length) return [];
	if (kind === 'immediate' && items.length <= PUSH_ITEMS_MAX) {
		return items.map((i) => ({
			title: oneLine(i.title, 150),
			body: oneLine(i.pushBody || i.body, PUSH_BODY_MAX),
			url: i.link ?? '/dashboard',
			tag: i.tag
		}));
	}
	const links = [...new Set(items.map((i) => i.link))];
	const titles = items.map((i) => oneLine(i.title, 80));
	return [
		{
			title:
				kind === 'daily'
					? tl(locale, 'notifications.digestSubject', { count: items.length })
					: tl(locale, 'notifications.newSubject', { count: items.length }),
			body: oneLine(titles.join(' · '), PUSH_BODY_MAX),
			url: links.length === 1 && links[0] ? links[0] : '/dashboard',
			tag: kind === 'daily' ? 'digest' : 'summary'
		}
	];
}
