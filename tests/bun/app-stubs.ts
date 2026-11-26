/**
 * Ersatz für SvelteKits `$app/*` in `bun test` (dort gibt es kein Vite und keinen SvelteKit-Laufzeitkontext).
 * Verhalten wie außerhalb eines Requests: `getRequestEvent` wirft, Navigation/Formulare sind No-ops.
 * Eingebunden über das Preload-Plugin (`tests/bun/preload.ts`).
 */

// --- $app/server ---------------------------------------------------------------------------------
export function getRequestEvent(): never {
	throw new Error(
		'Can only read the current request event inside functions invoked during `handle`, such as server `load` functions, actions, endpoints, and other server hooks.'
	);
}
export function read(): never {
	throw new Error('$app/server read() ist in bun test nicht verfügbar');
}

// --- $app/environment ----------------------------------------------------------------------------
export const browser = false;
export const building = false;
export const dev = false;
export const version = 'test';

// --- $app/navigation / $app/forms ----------------------------------------------------------------
export async function goto(): Promise<void> {}
export async function invalidate(): Promise<void> {}
export async function invalidateAll(): Promise<void> {}
export function beforeNavigate(): void {}
export function afterNavigate(): void {}
export function onNavigate(): void {}
export function pushState(): void {}
export function replaceState(): void {}
export function enhance(): { destroy(): void } {
	return { destroy() {} };
}
export function applyAction(): Promise<void> {
	return Promise.resolve();
}
export function deserialize(text: string): unknown {
	return JSON.parse(text);
}

// --- $app/state / $app/paths ---------------------------------------------------------------------
export const page = { url: new URL('http://localhost/'), params: {}, data: {}, state: {} };
export const navigating = { current: null };
export const updated = { current: false };
export const base = '';
export const assets = '';
export function resolve(path: string): string {
	return path;
}
