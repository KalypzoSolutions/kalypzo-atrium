import type { RequestContext } from '$lib/sdk/types';

export function ctxWith(...permissions: string[]): RequestContext {
	return {
		actor: { type: 'user', id: 'u1', name: 'u1@example.test' },
		userId: 'u1',
		permissions: new Set(permissions),
		ip: null,
		requestId: 'req'
	};
}

export const systemCtx: RequestContext = {
	actor: { type: 'system', id: null, name: 'system' },
	userId: null,
	permissions: new Set(),
	ip: null,
	requestId: 'sys'
};

/** Veraenderlicher Einstellungsspeicher fuer vi.mock('settings/service'). */
export const settingsStore: Record<string, unknown> = {};
