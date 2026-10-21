/**
 * Deutsche Zod-Standardmeldungen für Server und Client (#72, 06-10). Constraints ohne eigene
 * Meldung („Too big …“, „Invalid UUID“) erscheinen sonst englisch als 422-`details` bzw. Feldfehler.
 *
 * Häufige Fälle bekommen kurze, verständliche Texte; alles andere übernimmt das mitgelieferte
 * deutsche Locale von Zod. Eigene Meldungen an Schemas (`.max(5, 'Höchstens 5')`) haben Vorrang.
 * Wirkt global für die Zod-Instanz; einmal beim Start importieren (`hooks.server.ts`, API-Router,
 * Root-Layout im Client). Mehrfacher Import ist unschädlich.
 */
import { z } from 'zod';

const de = z.locales.de();
const fallback = de.localeError;

const UNITS: Record<string, [string, string]> = {
	string: ['Zeichen', 'Zeichen'],
	array: ['Eintrag', 'Einträge'],
	set: ['Eintrag', 'Einträge'],
	file: ['Byte', 'Bytes']
};

const FORMATS: Record<string, string> = {
	email: 'Ungültige E-Mail-Adresse',
	uuid: 'Ungültige ID',
	guid: 'Ungültige ID',
	url: 'Ungültige URL',
	date: 'Ungültiges Datum (JJJJ-MM-TT)',
	datetime: 'Ungültiger Zeitpunkt',
	time: 'Ungültige Uhrzeit',
	regex: 'Ungültiges Format'
};

function countText(n: number | bigint, origin: string): string {
	const unit = UNITS[origin];
	if (!unit) return String(n);
	return `${n} ${Number(n) === 1 ? unit[0] : unit[1]}`;
}

type Issue = Parameters<typeof fallback>[0];

export function germanZodError(issue: Issue): string | { message: string } | undefined | null {
	switch (issue.code) {
		case 'invalid_type':
			if (issue.input === undefined) return 'Pflichtfeld';
			break;
		case 'too_big': {
			const origin = String(issue.origin ?? '');
			const max = issue.maximum as number | bigint;
			if (UNITS[origin]) return `Höchstens ${countText(max, origin)}`;
			if (origin === 'number' || origin === 'int' || origin === 'bigint') {
				return issue.inclusive === false ? `Muss kleiner als ${max} sein` : `Höchstens ${max}`;
			}
			break;
		}
		case 'too_small': {
			const origin = String(issue.origin ?? '');
			const min = issue.minimum as number | bigint;
			if (origin === 'string' && Number(min) === 1) return 'Pflichtfeld';
			if (UNITS[origin]) return `Mindestens ${countText(min, origin)}`;
			if (origin === 'number' || origin === 'int' || origin === 'bigint') {
				return issue.inclusive === false ? `Muss größer als ${min} sein` : `Mindestens ${min}`;
			}
			break;
		}
		case 'invalid_format': {
			const text = FORMATS[String(issue.format)];
			if (text) return text;
			break;
		}
		case 'invalid_value':
			return 'Ungültiger Wert';
		case 'unrecognized_keys':
			return issue.keys.length === 1
				? `Unbekanntes Feld: ${issue.keys[0]}`
				: `Unbekannte Felder: ${issue.keys.join(', ')}`;
	}
	return fallback(issue);
}

z.config({ localeError: germanZodError });
