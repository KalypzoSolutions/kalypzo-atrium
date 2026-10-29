/**
 * Maskiert Kontaktdaten, bevor Text an den KI-Anbieter geht, und setzt sie im Ergebnis wieder ein.
 * Gleiche Werte bekommen dieselbe Marke; die Nummerierung gilt für alle Texte einer Anfrage.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** IBAN mit oder ohne Leerzeichen (2 Buchstaben, 2 Ziffern, 11–30 weitere Zeichen) */
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;
/** Telefonnummer: optional +/00, mindestens 7 Ziffern mit Leerzeichen, /, -, (, ) */
const PHONE_RE = /(?<![\w.])(?:\+|00)?\d[\d /()-]{5,}\d(?!\d)/g;

const KINDS = [
	{ re: EMAIL_RE, label: 'E-Mail' },
	{ re: IBAN_RE, label: 'IBAN' },
	{ re: PHONE_RE, label: 'Telefon' }
] as const;

export interface Redactor {
	/** Ersetzt Kontaktdaten durch Marken wie `[E-Mail 1]` */
	mask(text: string): string;
	/** Setzt die Originalwerte wieder ein */
	restore(text: string): string;
	/** Anzahl maskierter Werte */
	readonly count: number;
}

function digitCount(s: string): number {
	return s.replace(/\D/g, '').length;
}

export function createRedactor(): Redactor {
	const byValue = new Map<string, string>();
	const byToken = new Map<string, string>();
	const counters = new Map<string, number>();

	const tokenFor = (label: string, value: string): string => {
		const known = byValue.get(value);
		if (known) return known;
		const n = (counters.get(label) ?? 0) + 1;
		counters.set(label, n);
		const token = `[${label} ${n}]`;
		byValue.set(value, token);
		byToken.set(token, value);
		return token;
	};

	return {
		mask(text) {
			let out = text;
			for (const { re, label } of KINDS) {
				out = out.replace(re, (match) => {
					// Daten, Uhrzeiten und Beträge sind keine Telefonnummern
					if (label === 'Telefon' && digitCount(match) < 7) return match;
					return tokenFor(label, match);
				});
			}
			return out;
		},
		restore(text) {
			if (!byToken.size) return text;
			return text.replace(/\[(E-Mail|IBAN|Telefon) (\d+)\]/g, (m) => byToken.get(m) ?? m);
		},
		get count() {
			return byToken.size;
		}
	};
}
