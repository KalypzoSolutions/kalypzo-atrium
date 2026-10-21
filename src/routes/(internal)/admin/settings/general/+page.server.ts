import type { Actions } from '@sveltejs/kit';
import { loadCoreFields, loadCoreTab, saveAction } from '../../_shared/settings-actions.server';
import type { PageServerLoad } from './$types';

const MATCH = /^core\.(system|organization|legal)\./;
const RETENTION = /^core\.retention\./;
const SAVE = /^core\.(system|organization|legal|retention)\./;

export const load: PageServerLoad = async ({ locals }) => ({
	...(await loadCoreTab(locals, MATCH)),
	retentionFields: await loadCoreFields(RETENTION)
});

export const actions: Actions = { save: saveAction(SAVE) };
