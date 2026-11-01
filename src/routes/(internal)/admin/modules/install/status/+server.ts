import { json } from '@sveltejs/kit';
import {
	readSupervisorStatus,
	reconcileInstallEvents
} from '$lib/server/core/modules/install/supervisor-link';
import { requirePerm } from '../../../_shared/server-utils';
import type { RequestHandler } from './$types';

/** Stand des Supervisor-Neubaus (Abfrage alle 2 s aus der Installationsseite, nur lesend) */
export const GET: RequestHandler = async ({ locals }) => {
	requirePerm(locals, 'core.modules.install');
	const s = readSupervisorStatus();
	if (s.state === 'done' || s.state === 'failed') await reconcileInstallEvents();
	return json(s, { headers: { 'cache-control': 'no-store' } });
};
