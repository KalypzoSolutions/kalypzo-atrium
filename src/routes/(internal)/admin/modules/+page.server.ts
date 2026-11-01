import type { Actions } from '@sveltejs/kit';
import { z } from 'zod';
import {
	disableModule,
	enableModule,
	listModuleProblems,
	listModules
} from '$lib/server/core/modules/service';
import {
	checkUpdates,
	installDrift,
	restoreFromDatabase,
	uninstallModule
} from '$lib/server/core/modules/install/manage';
import { installStatus, listInstalledSources } from '$lib/server/core/modules/install/service';
import { isAdministrator } from '$lib/server/core/permissions/service';
import { failWithFields, invalid, requirePerm, toFail } from '../_shared/server-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.modules.view');
	const [modules, problems, sources, drift] = await Promise.all([
		listModules(),
		listModuleProblems(),
		listInstalledSources(locals.ctx),
		installDrift(locals.ctx)
	]);
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
								? `ZIP ${String(s.source.fileName ?? '')}`
								: 'Build',
					commit: s.commit
				}
			])
		),
		/** Gewünscht, aber nicht im laufenden Stand (z. B. nach Verlust des Volumes) */
		drift,
		canInstall: locals.ctx.permissions.has('core.modules.install') && isAdministrator(locals.ctx),
		installStatus: installStatus(),
		twoFactorEnabled: locals.user?.twoFactorEnabled ?? false,
		/** Gefunden, aber nicht geladen (defekt) bzw. nicht mehr installiert mit vorhandenen Daten */
		problems,
		modules: modules.map((m) => ({
			id: m.manifest.id,
			name: m.manifest.name,
			description: m.manifest.description ?? '',
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

export const actions: Actions = {
	enable: async ({ request, locals }) => {
		requirePerm(locals, 'core.modules.manage');
		const parsed = idSchema.safeParse({ id: (await request.formData()).get('id') });
		if (!parsed.success) return invalid(parsed.error);
		try {
			await enableModule(locals.ctx, parsed.data.id);
			return { success: true, message: 'Modul aktiviert' };
		} catch (e) {
			return toFail(e);
		}
	},
	checkUpdates: async ({ locals }) => {
		requirePerm(locals, 'core.modules.install');
		try {
			return { updates: await checkUpdates(locals.ctx) };
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
					? 'Modul wird entfernt – der Server baut neu und startet neu'
					: 'Modul entfernt'
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
			return { restored: result, message: 'Neubau angefordert' };
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
			return { success: true, message: 'Modul deaktiviert' };
		} catch (e) {
			return toFail(e);
		}
	}
};
