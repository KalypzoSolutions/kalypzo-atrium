/**
 * Geldbetraege als ganzzahlige Cent. Reine Funktionen ohne Seiteneffekte.
 */

/** Mehr Euro-Stellen werden abgelehnt, um Ueberlaeufe zu vermeiden */
const MAX_INT_DIGITS = 13;

/**
 * Liest eine (deutsche) Betragseingabe und liefert Cent.
 *
 * - Dezimaltrenner ist Komma; ist kein Komma vorhanden, gilt ein einzelner Punkt mit 1-2
 *   Nachkommastellen als Dezimalpunkt („12.50“), sonst als Tausendertrenner („1.234“).
 * - Punkte als Tausendertrenner, Leerzeichen und „€“ werden ignoriert.
 * - Mehr als zwei Nachkommastellen werden kaufmaennisch gerundet.
 * - Leere oder ungueltige Eingaben liefern `null`; negative Betraege ebenfalls (`null`).
 */
export function parseEuroToCents(text: string): number | null {
	const s = text.replace(/[\s€]/g, '');
	if (s === '' || !/^[0-9.,]+$/.test(s)) return null;

	let intPart: string;
	let frac = '';
	const comma = s.lastIndexOf(',');
	if (comma >= 0) {
		const head = s.slice(0, comma);
		frac = s.slice(comma + 1);
		if (frac.includes('.') || head.includes(',')) return null;
		intPart = head.replaceAll('.', '');
	} else {
		const dots = s.split('.').length - 1;
		const last = s.lastIndexOf('.');
		if (dots === 1 && s.length - last - 1 !== 3) {
			intPart = s.slice(0, last);
			frac = s.slice(last + 1);
		} else {
			intPart = s.replaceAll('.', '');
		}
	}
	if (intPart === '' && frac === '') return null;
	intPart = intPart.replace(/^0+(?=\d)/, '');
	if (intPart.length > MAX_INT_DIGITS) return null;

	const euros = intPart === '' ? 0 : Number(intPart);
	let cents = euros * 100 + Number((frac + '00').slice(0, 2));
	if (frac.length > 2 && Number(frac[2]) >= 5) cents += 1;
	return cents;
}

const decimal = new Intl.NumberFormat('de-DE', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});
const currency = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** „1.234,50“ (ohne Waehrungszeichen) */
export function formatCents(cents: number): string {
	return decimal.format(cents / 100);
}

/** „1.234,50 €“ */
export function formatEuro(cents: number): string {
	return currency.format(cents / 100);
}

/** Rundet auf volle Euro auf (in Cent) */
export function ceilToEuroCents(cents: number): number {
	return Math.ceil(cents / 100) * 100;
}
