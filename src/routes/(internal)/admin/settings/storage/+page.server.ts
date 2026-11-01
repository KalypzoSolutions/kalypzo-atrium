import { fail, type Actions } from '@sveltejs/kit';
import { isCoreError } from '$lib/server/core/errors';
import { t } from '$lib/i18n';
import { testConnection, usageByModule } from '$lib/server/core/storage';
import { loadFields, saveFields } from '../../_shared/group-form.server';
import { requirePerm } from '../../_shared/server-utils';
import type { PageServerLoad } from './$types';

const allowed = (key: string) => key.startsWith('core.storage.');

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.storage.manage');
	const [fields, usage] = await Promise.all([
		loadFields(['storage']),
		// Ohne konfigurierten Storage ist die Metadaten-Abfrage dennoch möglich; Fehler abfangen
		usageByModule(locals.ctx).catch(() => [])
	]);
	return { fields, usage };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		requirePerm(locals, 'core.storage.manage');
		return saveFields(locals, await request.formData(), allowed);
	},

	test: async ({ locals }) => {
		requirePerm(locals, 'core.storage.manage');
		try {
			await testConnection(locals.ctx);
			return { success: true, message: t('admin-settings.storage.testOk') };
		} catch (e) {
			if (isCoreError(e)) return fail(e.status, { message: e.message });
			throw e;
		}
	}
};
