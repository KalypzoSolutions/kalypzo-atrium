/**
 * IBAN-Hilfen für Core, Module und Browser (#70, 04-08). Reine Funktionen ohne Abhängigkeiten – die
 * einzige IBAN-Prüfung im Repo (`actions/iban.ts` und `treasury/iban.ts` reichen nur weiter).
 *
 *   import { isValidIban, normalizeIban, maskIbanTail } from '$lib/sdk/iban';
 */

/** Längen gängiger Länder; unbekannte Länder werden nur auf 15–34 Zeichen geprüft. */
const LENGTHS: Record<string, number> = {
	DE: 22,
	AT: 20,
	CH: 21,
	LI: 21,
	NL: 18,
	BE: 16,
	FR: 27,
	IT: 27,
	ES: 24,
	LU: 20,
	DK: 18,
	PL: 28,
	GB: 22,
	IE: 22,
	PT: 25,
	SE: 24,
	NO: 15,
	FI: 18,
	CZ: 24
};

/** Entfernt Leerzeichen/Trennzeichen und wandelt in Großbuchstaben um. */
export function normalizeIban(input: string): string {
	return input.replace(/[\s.-]+/g, '').toUpperCase();
}

/** Prüft Format, Länge (falls Land bekannt) und Prüfsumme (ISO 7064 mod 97-10). */
export function isValidIban(input: string): boolean {
	const iban = normalizeIban(input);
	if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
	const expected = LENGTHS[iban.slice(0, 2)];
	if (expected !== undefined && iban.length !== expected) return false;
	let remainder = 0;
	for (const ch of iban.slice(4) + iban.slice(0, 4)) {
		const value = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
		for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
	}
	return remainder === 1;
}

/** Gruppiert in Vierergruppen: `DE02 1203 0000 …` */
export function formatIban(input: string): string {
	return normalizeIban(input)
		.replace(/(.{4})/g, '$1 ')
		.trim();
}

/** Letzte `n` Stellen (für die Speicherung neben der verschlüsselten IBAN). */
export function ibanLast(input: string, n = 6): string {
	return normalizeIban(input).slice(-n);
}

/**
 * Maske aus den gespeicherten letzten 6 Stellen (ohne Entschlüsselung):
 * `013000` → `•••• •••• •••• •••• 0130 00` (Gesamtlänge `total`, Standard DE = 22).
 */
export function maskFromLast(last: string | null, total = 22): string | null {
	if (!last) return null;
	const hidden = Math.max(total - 4 - last.length, 0);
	const groups = ('•'.repeat(hidden).match(/.{1,4}/g) ?? []).join(' ');
	return ['••••', groups, last.replace(/(.{4})(.{2})$/, '$1 $2')].filter(Boolean).join(' ');
}

/** Kurzmaske aus den letzten 4 Stellen: `2051` → `•••• 2051` (leer → `null`). */
export function maskIbanTail(last4: string | null | undefined): string | null {
	return last4 ? `•••• ${last4}` : null;
}
