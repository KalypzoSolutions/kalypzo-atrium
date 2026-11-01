import { t } from '$lib/i18n';
import { json } from '@sveltejs/kit';
import { searchEverything } from '$lib/server/core/search/service';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Globale Suche für die Befehlspalette: `GET /search?q=…` → `{ data: SearchResponse }`.
 * Nur mit Login; Treffer nur aus Bereichen/Modulen, für die die Person Rechte hat.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) {
		return json({ message: t('dashboard-feed.notSignedIn') }, { status: 401, headers: NO_STORE });
	}
	const data = await searchEverything(locals.ctx, url.searchParams.get('q'));
	return json({ data }, { headers: NO_STORE });
};
