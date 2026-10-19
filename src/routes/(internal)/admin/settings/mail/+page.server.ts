import type { Actions } from '@sveltejs/kit';
import { loadCoreTab, saveAction, testMailAction } from '../../_shared/settings-actions.server';
import type { PageServerLoad } from './$types';

const MATCH = /^core\.smtp\./;

export const load: PageServerLoad = async ({ locals }) => ({
	...(await loadCoreTab(locals, MATCH)),
	email: locals.user?.email ?? ''
});

export const actions: Actions = { save: saveAction(MATCH), testMail: testMailAction };
