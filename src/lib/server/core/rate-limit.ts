/**
 * Einfacher Sliding-Window-Limiter im Arbeitsspeicher (eine Instanz pro Prozess).
 * Für Mehr-Instanz-Betrieb muss der Store durch einen gemeinsamen Speicher ersetzt werden
 * (siehe docs/security.md).
 */
interface Bucket {
	/** Größtes Fenster, mit dem dieser Schlüssel genutzt wurde – bestimmt das Aufräumen. */
	windowMs: number;
	hits: number[];
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

/** Mindestaufbewahrung beim Aufräumen, damit `peek` mit kurzem Fenster nichts zu früh verliert. */
const MIN_RETENTION_MS = 15 * 60_000;

/**
 * Entfernt veraltete Treffer – je Bucket mit **dessen eigenem** Fenster (#67, 01a-09). Früher galt das
 * Fenster des gerade laufenden Aufrufs für alle Buckets, wodurch z. B. 1-h-Limits auf 15 min schrumpften.
 */
function sweep(now: number): void {
	if (now - lastSweep < 60_000) return;
	lastSweep = now;
	for (const [k, bucket] of buckets) {
		const keep = Math.max(bucket.windowMs, MIN_RETENTION_MS);
		const fresh = bucket.hits.filter((t) => now - t < keep);
		if (fresh.length) bucket.hits = fresh;
		else buckets.delete(k);
	}
}

function bucketFor(key: string, windowMs: number): Bucket {
	let bucket = buckets.get(key);
	if (!bucket) {
		bucket = { windowMs, hits: [] };
		buckets.set(key, bucket);
	} else if (windowMs > bucket.windowMs) {
		bucket.windowMs = windowMs;
	}
	return bucket;
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
	sweep(now);
	const bucket = bucketFor(key, windowMs);
	// Treffer außerhalb des größten Fensters dieses Schlüssels verwerfen; innerhalb zählen nur die
	// Treffer im Fenster dieses Aufrufs (derselbe Schlüssel kann mit unterschiedlichen Fenstern genutzt werden).
	bucket.hits = bucket.hits.filter((t) => now - t < bucket.windowMs);
	const hits = bucket.hits.filter((t) => now - t < windowMs);
	if (hits.length >= limit) {
		const oldest = hits[0] ?? now;
		return {
			allowed: false,
			remaining: 0,
			retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
			limit
		};
	}
	bucket.hits.push(now);
	return { allowed: true, remaining: limit - hits.length - 1, retryAfterSec: 0, limit };
}

/** Nur zählen, ohne zu blockieren (z. B. fehlgeschlagene Logins). */
export function peek(key: string, windowSec: number): number {
	const now = Date.now();
	return (buckets.get(key)?.hits ?? []).filter((t) => now - t < windowSec * 1000).length;
}

export function reset(key: string): void {
	buckets.delete(key);
}

export function resetAllForTests(): void {
	buckets.clear();
	lastSweep = Date.now();
}
