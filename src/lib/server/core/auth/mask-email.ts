/** `anna@example.org` -> `a***@example.org` (für Audit-Einträge und Hinweise). */
export function maskEmail(email: string): string {
	const at = email.lastIndexOf('@');
	if (at < 1) return '***';
	return `${email[0]}***${email.slice(at)}`;
}

/**
 * Eingabe aus einem Login-Formular fürs Audit: maskiert, wenn sie wie eine E-Mail-Adresse aussieht,
 * sonst `[ungültig]` (z. B. versehentlich ins E-Mail-Feld getipptes Passwort).
 */
export function maskEmailInput(input: string): string {
	const v = input.trim();
	return /^[^\s@]+@[^\s@]+$/.test(v) ? maskEmail(v.toLowerCase()) : '[ungültig]';
}
