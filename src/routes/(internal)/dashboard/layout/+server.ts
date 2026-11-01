import { t } from '$lib/i18n';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { DASHBOARD_KEY_PATTERN, DASHBOARD_LAYOUT_MAX } from '$lib/sdk/client/dashboard-widgets';
import { isCoreError } from '$lib/server/core/errors';
import { setSetting } from '$lib/server/core/settings/service';
import type { RequestHandler } from './$types';

const key = z.string().max(80).regex(DASHBOARD_KEY_PATTERN);
const bodySchema = z
	.object({
		layout: z
			.object({
				order: z.array(key).max(DASHBOARD_LAYOUT_MAX),
				hidden: z.array(key).max(DASHBOARD_LAYOUT_MAX)
			})
			.strict()
			.nullable()
	})
	.strict();

function problem(status: number, message: string, details: unknown = null) {
	return json({ message, details }, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * Speichert die Anordnung des Dashboards (`core.user.dashboard`) des angemeldeten Benutzers.
 * Body `{ layout: { order, hidden } | null }`; `null` stellt den Standard wieder her.
 * JSON-Anfragen fallen nicht unter den Origin-Check von SvelteKit – daher eigener Same-Origin-Check.
 */
export const PUT: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) return problem(401, t('dashboard-feed.notSignedIn'));
	const origin = request.headers.get('origin');
	if (!origin || origin !== url.origin) return problem(403, t('dashboard-feed.invalidOrigin'));
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return problem(415, t('dashboard-feed.expectedJson'));
	}
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return problem(400, t('dashboard-feed.invalidJson'));
	}
	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) {
		return problem(422, t('dashboard-feed.invalidLayout'), parsed.error.issues);
	}
	try {
		await setSetting(locals.ctx, 'core.user.dashboard', parsed.data.layout);
	} catch (e) {
		if (isCoreError(e)) return problem(e.status, e.message);
		throw e;
	}
	return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
};
