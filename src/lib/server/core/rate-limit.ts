/**
 * Einfacher Sliding-Window-Limiter im Arbeitsspeicher (eine Instanz pro Prozess).
 * Für Mehr-Instanz-Betrieb muss der Store durch einen gemeinsamen Speicher ersetzt werden
 * (siehe docs/security.md).
 */
const buckets = new Map<string, number[]>();
let lastSweep = Date.now();

function sweep(now: number, windowMs: number): void {
	if (now - lastSweep < 60_000) return;
	lastSweep = now;
	for (const [k, hits] of buckets) {
		const fresh = hits.filter((t) => now - t < Math.max(windowMs, 15 * 60_000));
		if (fresh.length) buckets.set(k, fresh);
		else buckets.delete(k);
	}
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	/** Sekunden bis zum nächsten freien Slot */
	retryAfterSec: number;
	limit: number;
}

export function hit(key: string, limit: number, windowSec: number): RateLimitResult {
	const now = Date.now();
	const windowMs = windowSec * 1000;
	sweep(now, windowMs);
	const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
	if (hits.length >= limit) {
		buckets.set(key, hits);
		const oldest = hits[0] ?? now;
		return {
			allowed: false,
			remaining: 0,
			retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
			limit
		};
	}
	hits.push(now);
	buckets.set(key, hits);
	return { allowed: true, remaining: limit - hits.length, retryAfterSec: 0, limit };
}

/** Nur zählen, ohne zu blockieren (z. B. fehlgeschlagene Logins). */
export function peek(key: string, windowSec: number): number {
	const now = Date.now();
	return (buckets.get(key) ?? []).filter((t) => now - t < windowSec * 1000).length;
}

export function reset(key: string): void {
	buckets.delete(key);
}

export function resetAllForTests(): void {
	buckets.clear();
}
