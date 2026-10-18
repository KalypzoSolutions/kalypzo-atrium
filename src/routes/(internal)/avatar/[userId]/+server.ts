import { error } from '@sveltejs/kit';
import { readAvatar } from '$lib/server/core/auth/profile';
import type { RequestHandler } from './$types';

/**
 * Profilbild eines Benutzers (Quelle: Storage `core/avatars/<id>`). Alle angemeldeten Benutzer dürfen
 * Avatare sehen (gewollt, analog zum Benutzerverzeichnis). Deaktivierte Benutzer und fremde
 * `user.image`-Werte liefern kein Bild (siehe `readAvatar`).
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Nicht angemeldet');
	const avatar = await readAvatar(params.userId);
	if (!avatar) throw error(404, 'Kein Profilbild');
	return new Response(avatar.data as BodyInit, {
		headers: {
			'content-type': avatar.contentType,
			'cache-control': 'private, max-age=86400',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
};
