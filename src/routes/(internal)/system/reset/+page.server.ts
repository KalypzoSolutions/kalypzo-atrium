import { fail, type Actions } from '@sveltejs/kit';
import { z } from 'zod';
import { isCoreError } from '$lib/server/core/errors';
import {
	executeReset,
	listResetAreas,
	previewReset,
	RESET_CONFIRM_WORD
} from '$lib/server/core/system/reset';
import { invalid, requirePerm } from '../../settings/server-utils';
import type { PageServerLoad } from './$types';

const PERMISSION = 'core.system.reset';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, PERMISSION);
	const areas = await listResetAreas(locals.ctx);
	return {
		areas,
		twoFactorEnabled: locals.user?.twoFactorEnabled ?? false,
		confirmWord: RESET_CONFIRM_WORD
	};
};

/** Wie `toFail`, aber mit Fehlercode (409 = Token abgelaufen/verbraucht → Assistent neu starten). */
function coreFail(e: unknown) {
	if (isCoreError(e)) {
		let message = e.message;
		if (Array.isArray(e.details)) {
			const msgs = e.details
				.map((d) => (d && typeof d === 'object' ? (d as { message?: unknown }).message : null))
				.filter((m): m is string => typeof m === 'string' && m.length > 0);
			if (msgs.length) message = msgs.join('; ');
		}
		return fail(e.status, { message, code: e.code });
	}
	throw e;
}

const previewSchema = z.object({
	areas: z
		.array(z.string().min(1).max(80))
		.min(1, 'Bitte mindestens einen Bereich auswählen')
		.max(200)
});

const executeSchema = z.object({
	token: z.string().min(1, 'Token fehlt').max(500),
	confirmWord: z.string().max(100)
});

export const actions: Actions = {
	preview: async ({ request, locals }) => {
		requirePerm(locals, PERMISSION);
		const form = await request.formData();
		const parsed = previewSchema.safeParse({ areas: form.getAll('areas').map(String) });
		if (!parsed.success) return invalid(parsed.error);
		try {
			const preview = await previewReset(locals.ctx, parsed.data.areas);
			return { preview };
		} catch (e) {
			return coreFail(e);
		}
	},
	execute: async ({ request, locals }) => {
		requirePerm(locals, PERMISSION);
		const form = await request.formData();
		const parsed = executeSchema.safeParse({
			token: form.get('token'),
			confirmWord: form.get('confirmWord') ?? ''
		});
		if (!parsed.success) return invalid(parsed.error);
		try {
			const result = await executeReset(locals.ctx, parsed.data);
			return { result };
		} catch (e) {
			return coreFail(e);
		}
	}
};
