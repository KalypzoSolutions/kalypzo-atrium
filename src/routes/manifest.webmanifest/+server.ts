import { getLocale, t } from '$lib/i18n';
import { brandVersion, brandingState } from '$lib/server/core/branding';
import { getSetting } from '$lib/server/core/settings/service';
import type { RequestHandler } from './$types';

/**
 * Web-App-Manifest (öffentlich). Icons kommen aus dem Logo (`/branding/…`, ohne Logo die neutralen Icons); der Name
 * aus `core.system.name`. Die Version in den Icon-URLs ändert sich mit dem Logo, damit Geräte neu laden.
 */
export const GET: RequestHandler = async () => {
	const state = await brandingState();
	const v = brandVersion(state);
	let name = t('pwa.defaultName');
	try {
		const n = await getSetting<string>('core.system.name');
		if (typeof n === 'string' && n.trim()) name = n.trim().slice(0, 45);
	} catch {
		// Standardname
	}
	const icon = (file: string, size: number, purpose: 'any' | 'maskable') => ({
		src: `/branding/${file}?v=${v}`,
		sizes: `${size}x${size}`,
		type: 'image/png',
		purpose
	});
	const manifest = {
		name,
		// Unter dem Icon ist wenig Platz: lange Namen nicht abschneiden, sondern Kurzname nehmen
		short_name: name.length <= 15 ? name : t('pwa.shortName'),
		description: t('pwa.description', { name }),
		lang: getLocale(),
		id: '/',
		start_url: '/',
		scope: '/',
		display: 'standalone',
		launch_handler: { client_mode: ['navigate-existing', 'auto'] },
		background_color: '#ffffff',
		theme_color: '#ffffff',
		icons: [
			icon('icon-192.png', 192, 'any'),
			icon('icon-512.png', 512, 'any'),
			icon('maskable-512.png', 512, 'maskable')
		]
	};
	return new Response(JSON.stringify(manifest), {
		headers: {
			'content-type': 'application/manifest+json; charset=utf-8',
			'cache-control': 'public, max-age=300'
		}
	});
};
