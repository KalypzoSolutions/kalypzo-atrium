import { fail, type Actions } from '@sveltejs/kit';
import { z } from 'zod';
import { sendMail } from '$lib/server/core/mail';
import { upload } from '$lib/server/core/storage';
import { isCoreError } from '$lib/server/core/errors';
import { setSetting } from '$lib/server/core/settings/service';
import { loadFields, saveFields } from './group-form.server';
import { requirePerm, toFail } from './server-utils';
import type { PageServerLoad } from './$types';

const GROUPS = ['system', 'design', 'smtp', 'mail'] as const;
const allowed = (key: string) => /^core\.(system|organization|design|smtp|mail)\./.test(key);

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.settings.view');
	const fields = await loadFields([...GROUPS]);
	return {
		fields,
		canEdit: locals.ctx.permissions.has('core.settings.manage'),
		canUploadLogo:
			locals.ctx.permissions.has('core.settings.manage') &&
			(locals.ctx.permissions.has('core.storage.write') ||
				locals.ctx.permissions.has('core.storage.manage')),
		email: locals.user?.email ?? ''
	};
};

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export const actions: Actions = {
	save: async ({ request, locals }) => {
		requirePerm(locals, 'core.settings.manage');
		return saveFields(locals, await request.formData(), allowed);
	},

	testMail: async ({ request, locals }) => {
		requirePerm(locals, 'core.settings.manage');
		const parsed = z
			.string()
			.email('Ungültige E-Mail-Adresse')
			.safeParse((await request.formData()).get('to'));
		if (!parsed.success) return fail(422, { message: parsed.error.issues[0]?.message });
		try {
			await sendMail({
				to: parsed.data,
				subject: 'Test-E-Mail',
				text: 'Hallo,\n\ndiese Nachricht bestätigt, dass der E-Mail-Versand korrekt konfiguriert ist. So sieht eine E-Mail mit dem Stamm-Layout aus.'
			});
			return { success: true, message: `Test-E-Mail an ${parsed.data} gesendet` };
		} catch (e) {
			if (isCoreError(e)) return fail(e.status, { message: e.message });
			// SMTP-Fehlertext ohne Zugangsdaten an den Admin weiterreichen
			return fail(502, {
				message: `E-Mail-Versand fehlgeschlagen: ${e instanceof Error ? e.message : 'unbekannter Fehler'}`
			});
		}
	},

	uploadLogo: async ({ request, locals }) => {
		requirePerm(locals, 'core.settings.manage');
		const file = (await request.formData()).get('logo');
		if (!(file instanceof File) || file.size === 0) {
			return fail(422, { message: 'Bitte eine Bilddatei auswählen' });
		}
		if (!LOGO_TYPES.includes(file.type)) {
			return fail(422, { message: 'Erlaubt sind PNG, JPEG und WebP' });
		}
		if (file.size > MAX_LOGO_BYTES)
			return fail(422, { message: 'Das Logo darf maximal 2 MB groß sein' });
		try {
			const stored = await upload(locals.ctx, {
				module: 'core',
				path: `branding/logo-${Date.now()}`,
				file: new Uint8Array(await file.arrayBuffer()),
				contentType: file.type,
				name: file.name.slice(0, 120)
			});
			await setSetting(locals.ctx, 'core.design.logoFileId', stored.id);
			return { success: true, message: 'Logo hochgeladen' };
		} catch (e) {
			return toFail(e);
		}
	}
};
