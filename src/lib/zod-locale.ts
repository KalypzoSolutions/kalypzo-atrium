/**
 * Zod-Standardmeldungen in der Sprache des Requests bzw. der Seite (#72, Phase N) für Server und Client.
 * Constraints ohne eigene Meldung („Too big …“, „Invalid UUID“) erscheinen sonst englisch als 422-`details`
 * bzw. Feldfehler.
 *
 * Häufige Fälle bekommen kurze Texte aus `messages/<sprache>/zod.json`; alles andere übernimmt das
 * mitgelieferte Locale von Zod. Eigene Meldungen an Schemas (`.max(5, 'Höchstens 5')`) haben Vorrang.
 * Wirkt global für die Zod-Instanz; einmal beim Start importieren (`hooks.server.ts`, API-Router,
 * Root-Layout im Client). Mehrfacher Import ist unschädlich.
 */
import { z } from 'zod';
import { getLocale, t, type Locale } from '$lib/i18n';

const zodLocales: Record<Locale, ReturnType<typeof z.locales.de>> = {
	de: z.locales.de(),
	en: z.locales.en()
};

/** Zod-Herkunft → Schlüssel der Einheit (Mehrzahl über `count`) */
const UNITS: Record<string, string> = {
	string: 'chars',
	array: 'items',
	set: 'items',
	file: 'bytes'
};

const FORMATS = new Set(['email', 'uuid', 'guid', 'url', 'date', 'datetime', 'time', 'regex']);

type Issue = Parameters<(typeof zodLocales)['de']['localeError']>[0];

function countText(n: number | bigint, origin: string): string | null {
	const unit = UNITS[origin];
	return unit ? t(`zod.unit.${unit}`, { count: Number(n) }) : null;
}

export function localizedZodError(issue: Issue): string | { message: string } | undefined | null {
	switch (issue.code) {
		case 'invalid_type':
			if (issue.input === undefined) return t('zod.required');
			break;
		case 'too_big': {
			const origin = String(issue.origin ?? '');
			const max = issue.maximum as number | bigint;
			const count = countText(max, origin);
			if (count) return t('zod.atMost', { value: count });
			if (origin === 'number' || origin === 'int' || origin === 'bigint') {
				return issue.inclusive === false
					? t('zod.lessThan', { value: String(max) })
					: t('zod.atMost', { value: String(max) });
			}
			break;
		}
		case 'too_small': {
			const origin = String(issue.origin ?? '');
			const min = issue.minimum as number | bigint;
			if (origin === 'string' && Number(min) === 1) return t('zod.required');
			const count = countText(min, origin);
			if (count) return t('zod.atLeast', { value: count });
			if (origin === 'number' || origin === 'int' || origin === 'bigint') {
				return issue.inclusive === false
					? t('zod.greaterThan', { value: String(min) })
					: t('zod.atLeast', { value: String(min) });
			}
			break;
		}
		case 'invalid_format': {
			const format = String(issue.format);
			if (FORMATS.has(format)) return t(`zod.format.${format}`);
			break;
		}
		case 'invalid_value':
			return t('zod.invalidValue');
		case 'unrecognized_keys':
			return t('zod.unknownKeys', { count: issue.keys.length, keys: issue.keys.join(', ') });
	}
	return zodLocales[getLocale()].localeError(issue);
}

/** Alter Name (Tests, Aufrufer vor Phase N) */
export const germanZodError = localizedZodError;

z.config({ localeError: localizedZodError });
