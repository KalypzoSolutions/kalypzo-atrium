import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '$lib/i18n';
import { activeThemeSchema } from '$lib/appearance/schema';
import { isCoreError } from '$lib/server/core/errors';
import { setSetting } from '$lib/server/core/settings/service';
import { loadUserPrefs } from '$lib/server/core/settings/user-prefs';
import { resolveTheme } from '$lib/appearance/presets';
import type { RequestHandler } from './$types';

const bodySchema = z.union([
	z.object({ theme: z.enum(['light', 'dark', 'system']) }).strict(),
	z.object({ activeTheme: activeThemeSchema }).strict()
]);

/**
 * Speichert die Darstellung (hell/dunkel/system, `core.user.theme`) oder das aktive Theme
 * (`core.user.activeTheme`: `''`, Vorschlag oder eigenes Theme) des angemeldeten Benutzers.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, t('profile.errors.notSignedIn'));
	if (!request.headers.get('content-type')?.startsWith('application/json')) {
		throw error(415, t('profile.errors.jsonExpected'));
	}
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) throw error(422, t('profile.errors.invalidTheme'));
	try {
		if ('theme' in body.data) {
			await setSetting(locals.ctx, 'core.user.theme', body.data.theme);
			return json({ data: { theme: body.data.theme } });
		}
		const id = body.data.activeTheme;
		if (id && !resolveTheme(id, (await loadUserPrefs(locals.user.id)).themes)) {
			throw error(422, t('profile.errors.unknownTheme'));
		}
		await setSetting(locals.ctx, 'core.user.activeTheme', id);
		return json({ data: { activeTheme: id } });
	} catch (e) {
		if (isCoreError(e)) throw error(e.status, e.message);
		throw e;
	}
};
