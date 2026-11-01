import { inArray } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/core/database/client';
import { listInstallEvents, listInstalledSources } from '$lib/server/core/modules/install/service';
import { reconcileInstallEvents } from '$lib/server/core/modules/install/supervisor-link';
import { requirePerm } from '../../_shared/server-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.modules.view');
	// Ergebnis des Supervisors kommt erst nach dem Neustart (Health-Prüfung) – hier nachziehen
	await reconcileInstallEvents();
	const [events, installed] = await Promise.all([
		listInstallEvents(locals.ctx, 200),
		listInstalledSources(locals.ctx)
	]);
	const actorIds = [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))];
	const users = actorIds.length
		? await getDb()
				.select({ id: schema.user.id, name: schema.user.name })
				.from(schema.user)
				.where(inArray(schema.user.id, actorIds))
		: [];
	const names = new Map(users.map((u) => [u.id, u.name]));
	return {
		events: events.map((e) => ({
			...e,
			actor: e.actorId ? (names.get(e.actorId) ?? 'Unbekannt') : '–'
		})),
		installed
	};
};
