import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { isCoreError } from '$lib/server/core/errors';
import { setSetting } from '$lib/server/core/settings/service';
import type { RequestHandler } from './$types';

/** Speichert die Darstellung (hell/dunkel/system) des angemeldeten Benutzers (`core.user.theme`). */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Nicht angemeldet');
	if (!request.headers.get('content-type')?.startsWith('application/json')) {
		throw error(415, 'JSON erwartet');
	}
	const body = z
		.object({ theme: z.enum(['light', 'dark', 'system']) })
		.safeParse(await request.json().catch(() => null));
	if (!body.success) throw error(422, 'Ungueltige Darstellung');
	try {
		await setSetting(locals.ctx, 'core.user.theme', body.data.theme);
	} catch (e) {
		if (isCoreError(e)) throw error(e.status, e.message);
		throw e;
	}
	return json({ data: { theme: body.data.theme } });
};
