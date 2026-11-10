import type { Actions } from '@sveltejs/kit';
import { z } from 'zod';
import { localized, t } from '$lib/i18n';
import {
	disableModule,
	enableModule,
	listModuleProblems,
	listModules
} from '$lib/server/core/modules/service';
import {
	installDrift,
	restoreFromDatabase,
	rollbackInstall,
	rollbackPreview,
	uninstallModule
} from '$lib/server/core/modules/install/manage';
import {
	checkUpdates,
	ignoreUpdate,
	listUpdateChecks,
	setUpdateChannel
} from '$lib/server/core/modules/install/updates';
import { UPDATE_CHANNELS } from '$lib/server/core/modules/install/update-rules';
import { installStatus, listInstalledSources } from '$lib/server/core/modules/install/service';
import { isAdministrator } from '$lib/server/core/permissions/service';
import { failWithFields, invalid, requirePerm, toFail } from '../_shared/server-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.modules.view');
	const canInstall =
		locals.ctx.permissions.has('core.modules.install') && isAdministrator(locals.ctx);
	// Nacheinander: PGlite hat nur eine Sitzung
	const modules = await listModules();
	const problems = await listModuleProblems();
	const sources = await listInstalledSources(locals.ctx);
	const drift = await installDrift(locals.ctx);
	const updates = canInstall ? await listUpdateChecks(locals.ctx) : [];
	const rollback = canInstall ? await rollbackPreview(locals.ctx) : null;
	return {
		/** Herkunft je Modul (Quelle aus `module_install`, sonst im Build enthalten) */
		origins: Object.fromEntries(
			sources.map((s) => [
				s.id,
				{
					sourceType: s.sourceType,
					label:
						s.sourceType === 'github'
							? `${String(s.source.owner)}/${String(s.source.repo)}${s.source.path ? `/${String(s.source.path)}` : ''}`
							: s.sourceType === 'upload'
								? t('admin-modules.origins.zip', { name: String(s.source.fileName ?? '') })
								: t('admin-modules.origins.build'),
					commit: s.commit
				}
			])
		),
		/** Gewünscht, aber nicht im laufenden Stand (z. B. nach Verlust des Volumes) */
		drift,
		canInstall,
		/** Letzter Stand der Update-Prüfung je Modul aus einer Quelle */
		updates,
		/** Zurück zur vorigen Version (nur Supervisor mit voriger Generation) */
		rollback,
		installStatus: installStatus(),
		twoFactorEnabled: locals.user?.twoFactorEnabled ?? false,
		/** Gefunden, aber nicht geladen (defekt) bzw. nicht mehr installiert mit vorhandenen Daten */
		problems,
		modules: modules.map((m) => ({
			id: m.manifest.id,
			name: localized(m.manifest.name),
			description: localized(m.manifest.description),
			version: m.manifest.version,
			installedVersion: m.installedVersion,
			enabled: m.enabled,
			dependencies: m.manifest.dependencies,
			dependents: m.dependents,
			/** Alle installierten Module, die dieses hart brauchen (auch inaktive) – dann kein Entfernen */
			requiredBy: modules
				.filter((o) => o.manifest.dependencies.includes(m.manifest.id))
				.map((o) => o.manifest.id),
			missingDependencies: m.missingDependencies,
			permissionCount: m.manifest.permissions.length
		})),
		canManage: locals.ctx.permissions.has('core.modules.manage')
	};
};

const idSchema = z.object({ id: z.string().min(1).max(40) });
const channelSchema = z.object({
	id: z.string().min(1).max(40),
	channel: z.enum(UPDATE_CHANNELS as readonly ['release', 'branch'])
});

export const actions: Actions = {
	enable: async ({ request, locals }) => {
		requirePerm(locals, 'core.modules.manage');
		const parsed = idSchema.safeParse({ id: (await request.formData()).get('id') });
		if (!parsed.success) return invalid(parsed.error);
		try {
			await enableModule(locals.ctx, parsed.data.id);
			return { success: true, message: t('admin-modules.server.enabled') };
		} catch (e) {
			return toFail(e);
		}
	},
	checkUpdates: async ({ locals }) => {
		requirePerm(locals, 'core.modules.install');
		try {
			const updates = await checkUpdates(locals.ctx);
			const n = updates.filter((u) => u.status === 'update' || u.status === 'changed').length;
			return { message: t('admin-modules.server.updatesFound', { count: n }) };
		} catch (e) {
			return failWithFields(e);
		}
	},
	setChannel: async ({ request, locals }) => {
		requirePerm(locals, 'core.modules.install');
		const form = await request.formData();
		const parsed = channelSchema.safeParse({ id: form.get('id'), channel: form.get('channel') });
		if (!parsed.success) return invalid(parsed.error);
		try {
			await setUpdateChannel(locals.ctx, parsed.data.id, parsed.data.channel);
			return { message: t('admin-modules.server.channelSaved') };
		} catch (e) {
			return failWithFields(e);
		}
	},
	ignoreUpdate: async ({ request, locals }) => {
		requirePerm(locals, 'core.modules.install');
		const form = await request.formData();
		const parsed = idSchema.safeParse({ id: form.get('id') });
		if (!parsed.success) return invalid(parsed.error);
		const ignore = form.get('ignore') !== 'off';
		try {
			await ignoreUpdate(locals.ctx, parsed.data.id, ignore);
			return {
				message: ignore
					? t('admin-modules.server.updateIgnored')
					: t('admin-modules.server.updateUnignored')
			};
		} catch (e) {
			return failWithFields(e);
		}
	},
	rollback: async ({ request, locals }) => {
		requirePerm(locals, 'core.modules.install');
		const form = await request.formData();
		try {
			const result = await rollbackInstall(locals.ctx, {
				password: String(form.get('password') ?? ''),
				totp: String(form.get('totp') ?? '')
			});
			return { planId: result.planId, message: t('admin-modules.server.rollbackRequested') };
		} catch (e) {
			return failWithFields(e);
		}
	},
	uninstall: async ({ request, locals }) => {
		requirePerm(locals, 'core.modules.install');
		const form = await request.formData();
		try {
			const result = await uninstallModule(locals.ctx, {
				id: String(form.get('id') ?? ''),
				deleteData: form.get('deleteData') === 'on',
				confirmId: String(form.get('confirmId') ?? ''),
				password: String(form.get('password') ?? ''),
				totp: String(form.get('totp') ?? '')
			});
			return {
				uninstalled: result,
				message: result.planId
					? t('admin-modules.server.removing')
					: t('admin-modules.server.removed')
			};
		} catch (e) {
			return failWithFields(e);
		}
	},
	restore: async ({ request, locals }) => {
		requirePerm(locals, 'core.modules.install');
		const form = await request.formData();
		try {
			const result = await restoreFromDatabase(locals.ctx, {
				password: String(form.get('password') ?? ''),
				totp: String(form.get('totp') ?? '')
			});
			return { restored: result, message: t('admin-modules.server.buildRequested') };
		} catch (e) {
			return failWithFields(e);
		}
	},
	disable: async ({ request, locals }) => {
		requirePerm(locals, 'core.modules.manage');
		const parsed = idSchema.safeParse({ id: (await request.formData()).get('id') });
		if (!parsed.success) return invalid(parsed.error);
		try {
			await disableModule(locals.ctx, parsed.data.id);
			return { success: true, message: t('admin-modules.server.disabled') };
		} catch (e) {
			return toFail(e);
		}
	}
};
