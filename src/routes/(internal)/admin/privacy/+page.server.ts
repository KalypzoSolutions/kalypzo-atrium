import { findPrivacySubjects, PRIVACY_PERMISSION } from '$lib/server/core/privacy/service';
import { requirePerm } from '../_shared/server-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePerm(locals, PRIVACY_PERMISSION);
	const q = url.searchParams.get('q')?.trim().slice(0, 100) ?? '';
	const candidates = q.length >= 2 ? await findPrivacySubjects(locals.ctx, q) : [];
	return {
		q,
		candidates: candidates.map((c) => ({
			source: c.source,
			sourceName: c.sourceName,
			label: c.label,
			detail: c.detail ?? null,
			userId: c.subject.userId ?? null,
			memberId: c.subject.memberIds?.[0] ?? null
		}))
	};
};
