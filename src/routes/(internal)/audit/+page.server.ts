import { listAudit } from '$lib/server/core/audit/service';
import { resolvePageSize } from '$lib/server/core/settings/user-prefs';
import { requirePerm } from '../settings/server-utils';
import type { PageServerLoad } from './$types';

const DEFAULT_PAGE_SIZE = 50;

function parseDate(v: string | null, endOfDay = false): Date | undefined {
	if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
	const d = new Date(`${v}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
	return Number.isNaN(d.getTime()) ? undefined : d;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePerm(locals, 'core.audit.view');
	const q = url.searchParams.get('q')?.trim().slice(0, 100) ?? '';
	const action = url.searchParams.get('action')?.trim().slice(0, 100) ?? '';
	const from = url.searchParams.get('from') ?? '';
	const to = url.searchParams.get('to') ?? '';
	const PAGE_SIZE = await resolvePageSize(locals, DEFAULT_PAGE_SIZE);
	const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);

	const { rows, total } = await listAudit({
		search: q || undefined,
		action: action || undefined,
		from: parseDate(from),
		to: parseDate(to, true),
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE
	});

	return {
		rows: rows.map((r) => ({
			id: r.id,
			action: r.action,
			actorType: r.actorType,
			actorName: r.actorName,
			target: r.target,
			ip: r.ip,
			requestId: r.requestId,
			metadata: r.metadata,
			createdAt: r.createdAt
		})),
		total,
		page,
		pageSize: PAGE_SIZE,
		filter: { q, action, from, to }
	};
};
