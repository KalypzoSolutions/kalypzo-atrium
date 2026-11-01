/**
 * Wirksame PDF-Vorlagen: Core-Vorlagen (`pdf/templates/*.ts`, `default`, `compact`) plus Vorlagen aus Modulen
 * (`ModuleDefinition.pdfTemplates`). Eine Modul-Vorlage mit der ID einer Core-Vorlage **ersetzt** diese, solange
 * das Modul aktiv ist (bei mehreren: das erste in Ladereihenfolge); eigene IDs gelten nur bei aktivem Modul.
 * Alte IDs (`stamm-brief` …) werden über `TEMPLATE_ALIASES` aufgelöst.
 */
import { allDefinitions } from '../modules/registry';
import type { ModuleDefinition } from '../modules/types';
import { enabledModuleIds } from '../modules/state';
import { localized } from '$lib/i18n';
import {
	canonicalTemplateId,
	coreTemplates,
	describeTemplate,
	getTemplate,
	localizeTemplateText,
	type PdfTemplate,
	type TemplateDescription
} from './templates';

export interface ResolvedTemplate {
	template: PdfTemplate;
	/** Modul, das die Vorlage liefert (`null` = Core) */
	moduleId: string | null;
	moduleName: string | null;
}

function moduleTemplates(): { moduleId: string; moduleName: string; template: PdfTemplate }[] {
	const out: { moduleId: string; moduleName: string; template: PdfTemplate }[] = [];
	for (const def of allDefinitions()) {
		for (const template of def.pdfTemplates ?? []) {
			out.push({
				moduleId: def.manifest.id,
				moduleName: localized(def.manifest.name),
				template
			});
		}
	}
	return out;
}

/** Aktive Module; ohne Datenbank (z. B. reine Unit-Tests) keine */
async function activeModules(): Promise<Set<string>> {
	try {
		return await enabledModuleIds();
	} catch {
		return new Set();
	}
}

/** Wirksame Vorlage zu einer ID (Alias erlaubt); `undefined` = unbekannt oder Modul nicht aktiv */
export async function resolveTemplate(id: string): Promise<ResolvedTemplate | undefined> {
	const canonical = canonicalTemplateId(id);
	const candidates = moduleTemplates().filter((m) => m.template.id === canonical);
	if (candidates.length) {
		const enabled = await activeModules();
		const hit = candidates.find((m) => enabled.has(m.moduleId));
		if (hit) return { template: hit.template, moduleId: hit.moduleId, moduleName: hit.moduleName };
	}
	const core = getTemplate(canonical);
	return core ? { template: core, moduleId: null, moduleName: null } : undefined;
}

/**
 * IDs und Namen aller Vorlagen (synchron, für `core.pdf.listTemplates`): Core-Vorlagen und Modul-Vorlagen mit
 * eigener ID. Ob eine Modul-Vorlage gerade wirkt, entscheidet erst `resolveTemplate`.
 */
export function listTemplates(): { id: string; label: string }[] {
	const out = coreTemplates().map((tpl) => ({
		id: tpl.id,
		label: localizeTemplateText(tpl.label)
	}));
	const seen = new Set(out.map((x) => x.id));
	for (const m of moduleTemplates()) {
		if (seen.has(m.template.id)) continue;
		seen.add(m.template.id);
		out.push({ id: m.template.id, label: localizeTemplateText(m.template.label) });
	}
	return out;
}

export interface EffectiveTemplateDescription extends TemplateDescription {
	/** Herkunft der wirksamen Vorlage */
	origin: { type: 'core' } | { type: 'module'; moduleId: string; moduleName: string };
	/** `true`: ersetzt eine Core-Vorlage gleicher ID */
	replacesCore: boolean;
}

/** Wirksame Vorlagen für die Admin-Ansicht (Ersatz aus aktiven Modulen berücksichtigt) */
export async function describeTemplates(): Promise<EffectiveTemplateDescription[]> {
	const ids = [
		...new Set([
			...coreTemplates().map((tpl) => tpl.id),
			...moduleTemplates().map((m) => m.template.id)
		])
	];
	const out: EffectiveTemplateDescription[] = [];
	for (const id of ids) {
		const r = await resolveTemplate(id);
		if (!r) continue;
		out.push({
			...describeTemplate(r.template),
			origin:
				r.moduleId && r.moduleName
					? { type: 'module', moduleId: r.moduleId, moduleName: r.moduleName }
					: { type: 'core' },
			replacesCore: !!r.moduleId && !!getTemplate(id)
		});
	}
	return out;
}

/**
 * Wert eines Hooks des ersten **aktiven** Moduls, das ihn setzt (Ladereihenfolge), z. B. `brandingLogo` oder
 * `mailBranding`. Ohne Datenbank oder ohne passendes Modul `null`.
 */
export async function activeModuleHook<K extends 'brandingLogo' | 'mailBranding'>(
	key: K
): Promise<{ moduleId: string; value: NonNullable<ModuleDefinition[K]> } | null> {
	const defs = allDefinitions().filter((d) => d[key] !== undefined && d[key] !== null);
	if (!defs.length) return null;
	const enabled = await activeModules();
	const hit = defs.find((d) => enabled.has(d.manifest.id));
	return hit
		? { moduleId: hit.manifest.id, value: hit[key] as NonNullable<ModuleDefinition[K]> }
		: null;
}
