import { error, redirect } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { BRAND_ICONS, brandIcon, brandLogo, brandingState } from '$lib/server/core/branding';
import type { RequestHandler } from './$types';

/**
 * Öffentlich (auch Login, Manifest, Push): Logo und daraus erzeugte Icons. Ohne Logo (weder hochgeladen noch aus
 * einem aktiven Modul) → neutrale Icons aus `static/icons/`. Das Logo ist kein Geheimnis; Inhalt kommt nur aus `core/branding/` (neu kodiertes PNG).
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const state = await brandingState();
	const headers = {
		'content-type': 'image/png',
		// Mit Version in der URL (`?v=`) lange cachebar, sonst kurz
		'cache-control': url.searchParams.has('v')
			? 'public, max-age=604800, immutable'
			: 'public, max-age=300',
		'x-content-type-options': 'nosniff',
		'content-security-policy': "default-src 'none'; sandbox"
	};
	if (params.file === 'logo.png') {
		const logo = await brandLogo(state);
		if (!logo) throw error(404, t('branding.noLogo'));
		return new Response(logo as BodyInit, { headers });
	}
	const icon = await brandIcon(params.file, state);
	if (icon === undefined) throw error(404, t('branding.notFound'));
	if (icon === null) throw redirect(302, `/icons/${BRAND_ICONS[params.file]!.fallback}`);
	return new Response(icon as BodyInit, { headers });
};
