import type { Actions } from '@sveltejs/kit';
import {
	canUploadLogo,
	loadCoreTab,
	saveAction,
	uploadLogoAction
} from '../../_shared/settings-actions.server';
import type { PageServerLoad } from './$types';

const MATCH = /^core\.design\./;

export const load: PageServerLoad = async ({ locals }) => ({
	...(await loadCoreTab(locals, MATCH)),
	canUploadLogo: canUploadLogo(locals)
});

export const actions: Actions = { save: saveAction(MATCH), uploadLogo: uploadLogoAction };
