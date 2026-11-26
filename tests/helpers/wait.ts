/**
 * Wartet, bis `fn` ohne Fehler durchläuft (wie `vi.waitFor` aus Vitest), höchstens `timeout` ms.
 * Für Asynchrones ohne eigenes Ereignis – feste Wartezeiten bleiben verboten (#75).
 */
export async function waitFor<T>(
	fn: () => T | Promise<T>,
	opts: { timeout?: number; interval?: number } | number = {}
): Promise<T> {
	const { timeout = 1000, interval = 20 } = typeof opts === 'number' ? { timeout: opts } : opts;
	const until = Date.now() + timeout;
	for (;;) {
		try {
			return await fn();
		} catch (e) {
			if (Date.now() >= until) throw e;
			await new Promise((r) => setTimeout(r, interval));
		}
	}
}
