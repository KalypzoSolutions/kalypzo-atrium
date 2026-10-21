import type { Actions } from '@sveltejs/kit';
import { allDefinitions } from '$lib/server/core/modules/registry';
import { enabledModuleIds } from '$lib/server/core/modules/state';
import { loadFields, saveFields } from '../../_shared/group-form.server';
import { requirePerm } from '../../_shared/server-utils';
import type { PageServerLoad } from './$types';

/** Aktive Module mit Einstellungen; `ownPage` = Navigationseintrag mit `admin` + `settingsPage`. */
async function modulesWithSettings() {
	const enabled = await enabledModuleIds();
	return allDefinitions()
		.filter((d) => enabled.has(d.manifest.id) && (d.settings?.length ?? 0) > 0)
		.map((d) => ({
			id: d.manifest.id,
			name: d.manifest.name,
			description: d.manifest.description ?? null,
			keys: (d.settings ?? []).map((s) => s.key),
			ownPage: d.manifest.navigation.find((n) => n.admin && n.settingsPage) ?? null
		}))
		.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.settings.view');
	const perms = locals.ctx.permissions;
	const modules = await Promise.all(
		(await modulesWithSettings()).map(async (m) => {
			if (m.ownPage) {
				return {
					id: m.id,
					name: m.name,
					description: m.description,
					fields: [],
					ownPage: {
						href: m.ownPage.path,
						// Link nur, wenn die Seite für diese Person sichtbar ist
						canOpen: !m.ownPage.permission || perms.has(m.ownPage.permission)
					}
				};
			}
			const prefix = `${m.name}: `;
			const fields = (await loadFields([m.id])).map((f) => ({
				...f,
				label: f.label.startsWith(prefix) ? f.label.slice(prefix.length) : f.label
			}));
			return { id: m.id, name: m.name, description: m.description, fields, ownPage: null };
		})
	);
	return { modules, canEdit: perms.has('core.settings.manage') };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		requirePerm(locals, 'core.settings.manage');
		// Nur Schlüssel aktiver Module ohne eigene Einstellungsseite
		const allowed = new Set(
			(await modulesWithSettings()).filter((m) => !m.ownPage).flatMap((m) => m.keys)
		);
		return saveFields(locals, await request.formData(), (key) => allowed.has(key));
	}
};
