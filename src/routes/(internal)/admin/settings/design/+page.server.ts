import type { Actions } from '@sveltejs/kit';
import { brandingState, uploadedLogoUrl } from '$lib/server/core/branding';
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
	// nur das hochgeladene Logo (nicht das Ersatz-Logo eines Profil-Moduls)
	logoUrl: uploadedLogoUrl(await brandingState())
});

export const actions: Actions = {
	save: saveAction(MATCH),
	uploadLogo: uploadLogoAction,
	removeLogo: removeLogoAction
};
