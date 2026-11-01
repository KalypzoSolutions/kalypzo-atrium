import type { Actions } from '@sveltejs/kit';
import { loadCoreFields, loadCoreTab, saveAction } from '../../_shared/settings-actions.server';
import type { PageServerLoad } from './$types';

/** System (Name, Sprache), Organisation (inkl. Bezeichnung für „alle“, `core.org.*`) und rechtliche Links */
const MATCH = /^core\.(system|org|organization|legal)\./;
const RETENTION = /^core\.retention\./;
const SAVE = /^core\.(system|org|organization|legal|retention)\./;

export const load: PageServerLoad = async ({ locals }) => ({
	...(await loadCoreTab(locals, MATCH)),
	retentionFields: await loadCoreFields(RETENTION)
});

export const actions: Actions = { save: saveAction(SAVE) };
