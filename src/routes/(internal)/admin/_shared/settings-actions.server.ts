import { fail, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '$lib/i18n';
import { sendMail } from '$lib/server/core/mail';
import { removeLogo, setLogo } from '$lib/server/core/branding';
import { isCoreError } from '$lib/server/core/errors';
import { loadFields, saveFields, type FieldDescriptor } from './group-form.server';
import { requirePerm, toFail } from './server-utils';

/** Gruppen der Core-Einstellungen auf den Reitern Allgemein, Design, E-Mail-Versand und E-Mail-Layout */
const CORE_GROUPS = ['system', 'design', 'smtp', 'mail'];

/** Core-Felder, deren Schlüssel auf `match` passt (Gruppen-übergreifend, Reihenfolge des Katalogs). */
export function loadCoreFields(match: RegExp): Promise<FieldDescriptor[]> {
	return loadFields(CORE_GROUPS, (key) => match.test(key));
}

/** Grunddaten eines Core-Reiters: Felder + ob gespeichert werden darf. */
export async function loadCoreTab(locals: App.Locals, match: RegExp) {
	requirePerm(locals, 'core.settings.view');
	return {
		fields: await loadCoreFields(match),
		canEdit: locals.ctx.permissions.has('core.settings.manage')
	};
}

/** Speichern-Action, die nur Schlüssel passend zu `match` annimmt. */
export function saveAction(match: RegExp) {
	return async ({ request, locals }: RequestEvent) => {
		requirePerm(locals, 'core.settings.manage');
		return saveFields(locals, await request.formData(), (key) => match.test(key));
	};
}

/** Test-E-Mail mit dem aktuellen SMTP-Versand und E-Mail-Layout. */
export async function testMailAction({ request, locals }: RequestEvent) {
	requirePerm(locals, 'core.settings.manage');
	const parsed = z
		.string()
		.email({ error: () => t('admin-settings.testMail.invalidEmail') })
		.safeParse((await request.formData()).get('to'));
	if (!parsed.success) return fail(422, { message: parsed.error.issues[0]?.message });
	try {
		await sendMail({
			to: parsed.data,
			subject: t('admin-settings.testMail.subject'),
			text: t('admin-settings.testMail.text')
		});
		return { success: true, message: t('admin-settings.testMail.sent', { to: parsed.data }) };
	} catch (e) {
		if (isCoreError(e)) return fail(e.status, { message: e.message });
		// Details (Host, Port, Antwort des Servers) nur ins Server-Log – die Oberfläche bekommt keine
		// Verbindungsinterna (sonst Port-/Dienstscan im internen Netz über die Testmail möglich)
		console.error('[core] Test-E-Mail fehlgeschlagen:', e);
		return fail(502, {
			message: t('admin-settings.testMail.failed')
		});
	}
}

/** Darf Logos hochladen: Einstellungen ändern + Storage schreiben. */
export function canUploadLogo(locals: App.Locals): boolean {
	const p = locals.ctx.permissions;
	return (
		p.has('core.settings.manage') && (p.has('core.storage.write') || p.has('core.storage.manage'))
	);
}

/** Logo hochladen (neu kodiert, Storage `core/branding/…`) und als `core.design.logoFileId` setzen. */
export async function uploadLogoAction({ request, locals }: RequestEvent) {
	requirePerm(locals, 'core.settings.manage');
	const file = (await request.formData()).get('logo');
	if (!(file instanceof File) || file.size === 0) {
		return fail(422, { message: t('admin-settings.logo.chooseFile') });
	}
	try {
		await setLogo(locals.ctx, {
			data: new Uint8Array(await file.arrayBuffer()),
			contentType: file.type,
			name: file.name.slice(0, 120)
		});
		return { success: true, message: t('admin-settings.logo.saved') };
	} catch (e) {
		return toFail(e);
	}
}

/** Logo entfernen (Wappen als Favicon/App-Icon, PDFs ohne Logo). */
export async function removeLogoAction({ locals }: RequestEvent) {
	requirePerm(locals, 'core.settings.manage');
	try {
		await removeLogo(locals.ctx);
		return { success: true, message: t('admin-settings.logo.removed') };
	} catch (e) {
		return toFail(e);
	}
}
