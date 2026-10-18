/** `anna@example.org` -> `a***@example.org` (für Audit-Einträge und Hinweise). */
export function maskEmail(email: string): string {
	const at = email.lastIndexOf('@');
	if (at < 1) return '***';
	return `${email[0]}***${email.slice(at)}`;
}
