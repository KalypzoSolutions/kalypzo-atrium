import type { Actions } from '@sveltejs/kit';
import { estimateCost, usageSummary } from '$lib/server/core/ai';
import { getSetting } from '$lib/server/core/settings/service';
import { loadFields, saveFields } from '../../_shared/group-form.server';
import { requirePerm } from '../../_shared/server-utils';
import type { PageServerLoad } from './$types';

const allowed = (key: string) => key.startsWith('core.ai.');

export const load: PageServerLoad = async ({ locals }) => {
	if (
		!locals.ctx.permissions.has('core.ai.view') &&
		!locals.ctx.permissions.has('core.ai.manage')
	) {
		requirePerm(locals, 'core.ai.view');
	}
	const canManage = locals.ctx.permissions.has('core.ai.manage');
	const [rows, pricing, tokenLimit, costLimit] = await Promise.all([
		usageSummary(locals.ctx),
		getSetting<Record<string, { input: number; output: number }>>('core.ai.pricing'),
		getSetting<number>('core.ai.monthlyTokenLimit'),
		getSetting<number>('core.ai.monthlyCostLimitUsd')
	]);
	const usage = rows.map((r) => ({
		...r,
		costUsd: estimateCost(pricing, r.model, r.inputTokens, r.outputTokens)
	}));
	return {
		usage,
		totals: {
			requests: usage.reduce((s, r) => s + r.requests, 0),
			inputTokens: usage.reduce((s, r) => s + r.inputTokens, 0),
			outputTokens: usage.reduce((s, r) => s + r.outputTokens, 0),
			costUsd: usage.reduce((s, r) => s + r.costUsd, 0)
		},
		limits: { tokens: tokenLimit, costUsd: costLimit },
		// Konfiguration nur mit core.ai.manage (enthält Secret-Status)
		fields: canManage ? await loadFields(['ai']) : [],
		canManage
	};
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		requirePerm(locals, 'core.ai.manage');
		return saveFields(locals, await request.formData(), allowed);
	}
};
