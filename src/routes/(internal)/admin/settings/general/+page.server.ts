import type { Actions } from '@sveltejs/kit';
import { loadCoreTab, saveAction } from '../../_shared/settings-actions.server';
import type { PageServerLoad } from './$types';

const MATCH = /^core\.(system|organization)\./;

export const load: PageServerLoad = async ({ locals }) => loadCoreTab(locals, MATCH);

export const actions: Actions = { save: saveAction(MATCH) };
