import type { Actions } from '@sveltejs/kit';
import { describeTemplates, listTemplates } from '$lib/server/core/pdf';
import { loadFields, saveFields } from '../../_shared/group-form.server';
import { requirePerm } from '../../_shared/server-utils';
import type { PageServerLoad } from './$types';

const allowed = (key: string) => key.startsWith('core.pdf.');

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.pdf.manage');
	return {
		fields: await loadFields(['pdf']),
		templates: listTemplates(),
		templateInfo: await describeTemplates()
	};
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		requirePerm(locals, 'core.pdf.manage');
		return saveFields(locals, await request.formData(), allowed);
	}
};
