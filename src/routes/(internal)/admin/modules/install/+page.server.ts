import { fail, type Actions } from '@sveltejs/kit';
import { z } from 'zod';
import {
	confirmInstall,
	inspectSource,
	installStatus,
	previewInstall
} from '$lib/server/core/modules/install/service';
import { readSupervisorStatus } from '$lib/server/core/modules/install/supervisor-link';
import { getSetting, setSettings } from '$lib/server/core/settings/service';
import { failWithFields as failWith, requirePerm } from '../../_shared/server-utils';
import type { PageServerLoad } from './$types';

const PERM = 'core.modules.install';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, PERM);
	return {
		status: installStatus(),
		supervisor: installStatus().mode === 'supervisor' ? readSupervisorStatus() : null,
		twoFactorEnabled: locals.user?.twoFactorEnabled ?? false,
		hasToken: !!String((await getSetting('core.modules.githubToken')) ?? '').trim(),
		allowedSources: String((await getSetting('core.modules.allowedSources')) ?? '')
	};
};

export const actions: Actions = {
	inspect: async ({ request, locals }) => {
		requirePerm(locals, PERM);
		const form = await request.formData();
		const file = form.get('file');
		const url = String(form.get('url') ?? '').trim();
		try {
			const inspection =
				file instanceof File && file.size > 0
					? await inspectSource(locals.ctx, {
							zip: new Uint8Array(await file.arrayBuffer()),
							fileName: file.name
						})
					: await inspectSource(locals.ctx, { url });
			return { step: 'inspect' as const, inspection };
		} catch (e) {
			return failWith(e);
		}
	},
	preview: async ({ request, locals }) => {
		requirePerm(locals, PERM);
		const form = await request.formData();
		try {
			const preview = await previewInstall(locals.ctx, {
				sourceToken: String(form.get('sourceToken') ?? ''),
				selected: form.getAll('selected').map(String)
			});
			return { step: 'preview' as const, preview };
		} catch (e) {
			return failWith(e);
		}
	},
	install: async ({ request, locals }) => {
		requirePerm(locals, PERM);
		const form = await request.formData();
		try {
			const result = await confirmInstall(locals.ctx, {
				token: String(form.get('token') ?? ''),
				password: String(form.get('password') ?? ''),
				totp: String(form.get('totp') ?? '')
			});
			return { step: 'done' as const, result };
		} catch (e) {
			return failWith(e);
		}
	},
	settings: async ({ request, locals }) => {
		requirePerm(locals, PERM);
		const form = await request.formData();
		const parsed = z
			.object({
				token: z.string().max(400),
				clearToken: z.boolean(),
				allowedSources: z.string().max(2000)
			})
			.safeParse({
				token: String(form.get('token') ?? '').trim(),
				clearToken: form.get('clearToken') === 'on',
				allowedSources: String(form.get('allowedSources') ?? '')
			});
		if (!parsed.success) return fail(422, { message: 'Eingaben ungültig', fields: {} });
		const values: Record<string, unknown> = {
			'core.modules.allowedSources': parsed.data.allowedSources.trim()
		};
		if (parsed.data.clearToken) values['core.modules.githubToken'] = '';
		else if (parsed.data.token) values['core.modules.githubToken'] = parsed.data.token;
		try {
			await setSettings(locals.ctx, values);
			return { step: 'settings' as const, message: 'Gespeichert' };
		} catch (e) {
			return failWith(e);
		}
	}
};
