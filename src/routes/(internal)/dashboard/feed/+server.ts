import { json } from '@sveltejs/kit';
import { collectDashboardFeed } from '$lib/server/core/dashboard/feed';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * „Zu erledigen“ und „Diese Woche“ für die angemeldete Person (`collectDashboardFeed`): Quellen der
 * aktiven Module, jeweils nur mit Recht und objektbezogen gefiltert.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ message: 'Nicht angemeldet' }, { status: 401, headers: NO_STORE });
	}
	const data = await collectDashboardFeed(locals.ctx);
	return json({ data }, { headers: NO_STORE });
};
