/** Anzeige eines Zählers: leer bei 0 (bzw. ungültig), ab `max + 1` „9+“ */
export function formatCount(count: number, max = 9): string {
	if (!Number.isFinite(count) || count <= 0) return '';
	const n = Math.floor(count);
	return n > max ? `${max}+` : String(n);
}
