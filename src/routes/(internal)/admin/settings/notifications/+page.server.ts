import type { Actions } from '@sveltejs/kit';
import { loadFields, saveFields } from '../../_shared/group-form.server';
import { requirePerm, toFail } from '../../_shared/server-utils';
import { rotateVapidKeys, totalDevices, vapidKeys } from '$lib/server/core/notifications/push';
import type { PageServerLoad } from './$types';

// Nur der Schalter ist änderbar; die VAPID-Schlüssel erzeugt das System selbst
const allowed = (key: string) => key === 'core.push.enabled';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.settings.view');
	const [fields, keys, devices] = await Promise.all([
		loadFields(['push'], allowed),
		vapidKeys(),
		totalDevices()
	]);
	return {
		fields,
		publicKey: keys.publicKey,
		devices,
		canEdit: locals.ctx.permissions.has('core.settings.manage')
	};
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		requirePerm(locals, 'core.settings.manage');
		return saveFields(locals, await request.formData(), allowed);
	},
	rotate: async ({ locals }) => {
		requirePerm(locals, 'core.settings.manage');
		try {
			const r = await rotateVapidKeys(locals.ctx);
			return {
				success: true,
				message: `Neue Schlüssel erzeugt – ${r.removedDevices} Geräte müssen Push neu aktivieren`
			};
		} catch (e) {
			return toFail(e);
		}
	}
};
