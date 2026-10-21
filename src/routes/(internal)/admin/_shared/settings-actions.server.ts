import { fail, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { sendMail } from '$lib/server/core/mail';
import { upload } from '$lib/server/core/storage';
import { isCoreError } from '$lib/server/core/errors';
import { setSetting } from '$lib/server/core/settings/service';
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

/** Test-E-Mail mit dem aktuellen SMTP-Versand und Stamm-Layout. */
export async function testMailAction({ request, locals }: RequestEvent) {
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
		// Details (Host, Port, Antwort des Servers) nur ins Server-Log – die Oberfläche bekommt keine
		// Verbindungsinterna (sonst Port-/Dienstscan im internen Netz über die Testmail möglich)
		console.error('[core] Test-E-Mail fehlgeschlagen:', e);
		return fail(502, {
			message:
				'E-Mail-Versand fehlgeschlagen. Bitte Host, Port, TLS und Zugangsdaten prüfen; Details stehen im Server-Protokoll.'
		});
	}
}

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Darf Logos hochladen: Einstellungen ändern + Storage schreiben. */
export function canUploadLogo(locals: App.Locals): boolean {
	const p = locals.ctx.permissions;
	return (
		p.has('core.settings.manage') && (p.has('core.storage.write') || p.has('core.storage.manage'))
	);
}

/** Logo hochladen (Storage `core/branding/…`) und als `core.design.logoFileId` setzen. */
export async function uploadLogoAction({ request, locals }: RequestEvent) {
	requirePerm(locals, 'core.settings.manage');
	const file = (await request.formData()).get('logo');
	if (!(file instanceof File) || file.size === 0) {
		return fail(422, { message: 'Bitte wähle eine Bilddatei aus' });
	}
	if (!LOGO_TYPES.includes(file.type)) {
		return fail(422, { message: 'Erlaubt sind PNG, JPEG und WebP' });
	}
	if (file.size > MAX_LOGO_BYTES) {
		return fail(422, { message: 'Das Logo darf maximal 2 MB groß sein' });
	}
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
