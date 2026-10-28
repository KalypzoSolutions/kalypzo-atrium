import type { Actions } from '@sveltejs/kit';
import { brandingState, logoUrl } from '$lib/server/core/branding';
import {
	canUploadLogo,
	loadCoreTab,
	removeLogoAction,
	saveAction,
	uploadLogoAction
} from '../../_shared/settings-actions.server';
import type { PageServerLoad } from './$types';

/** Design-Einstellungen ohne die Logo-ID (die setzt nur der Upload) */
const MATCH = /^core\.design\.(?!logoFileId$)/;

export const load: PageServerLoad = async ({ locals }) => ({
	...(await loadCoreTab(locals, MATCH)),
	canUploadLogo: canUploadLogo(locals),
	logoUrl: logoUrl(await brandingState())
});

export const actions: Actions = {
	save: saveAction(MATCH),
	uploadLogo: uploadLogoAction,
	removeLogo: removeLogoAction
};
