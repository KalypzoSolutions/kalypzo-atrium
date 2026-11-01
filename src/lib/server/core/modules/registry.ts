import { localized, t, type LocalizedText, type MessageParams } from '$lib/i18n';
import type { ModuleManifest, ResolvedModuleManifest } from '$lib/sdk/types';
import { PERMISSION_PATTERN } from '../permissions/catalog';
import { errors } from '../errors';
import { NOTIFICATION_KEY_PATTERN, allowedChannels } from '$lib/sdk/types/notifications';
import { MODULE_ID_PATTERN, RESERVED_MODULE_IDS, type ModuleDefinition } from './types';
import { CORE_VERSION } from '../version';
import {
	AGENDA_KIND_PATTERN,
	CORE_AGENDA_KINDS,
	DASHBOARD_AGENDA_STYLES
} from '$lib/sdk/types/dashboard';
import { parseModulePackage, versionSatisfies, type ModulePackage } from './package/schema';

/**
 * Build-Zeit-Registrierung. Hier wird nur bekannt gemacht, WELCHE Module im Build enthalten
 * sind. Ob ein Modul laufzeitseitig aktiv ist, entscheidet `module_state` (siehe state.ts).
 */
const definitions = new Map<string, ModuleDefinition>();

/** Module, die gefunden, aber nicht geladen wurden (ungültig, Abhängigkeit fehlt, Core-Version passt nicht) */
export interface BrokenModule {
	id: string;
	name: string;
	version: string | null;
	reason: string;
}

/** Grund als i18n-Schlüssel (beim Ausliefern übersetzt) oder fertiger Text (z. B. Fehlermeldung des Moduls) */
export type BrokenReason = string | { key: string; params?: MessageParams };

/** Eintrag beim Merken: Name je Sprache möglich, Grund ggf. als Schlüssel */
export interface BrokenModuleEntry {
	id: string;
	name: LocalizedText;
	version: string | null;
	reason: BrokenReason;
}
const broken = new Map<string, BrokenModuleEntry>();

function reasonText(reason: BrokenReason): string {
	return typeof reason === 'string' ? reason : t(reason.key, reason.params);
}

/** Manifest mit aufgelösten Texten (Name, Navigation, Rechte-Beschreibungen) in der Sprache des Requests */
export function resolveManifest(m: ModuleManifest): ResolvedModuleManifest {
	const { permissionDescriptions: _descriptions, ...rest } = m;
	void _descriptions;
	return {
		...rest,
		name: localized(m.name),
		navigation: m.navigation.map((n) => ({ ...n, label: localized(n.label) })),
		...(m.permissionDescriptions
			? {
					permissionDescriptions: Object.fromEntries(
						Object.entries(m.permissionDescriptions).map(([k, v]) => [k, localized(v)])
					)
				}
			: {})
	};
}

/** Paket ↔ Manifest: gleicher deutscher Name (das Manifest darf weitere Sprachen ergänzen) */
function sameText(a: LocalizedText, b: LocalizedText): boolean {
	return localized(a, 'de') === localized(b, 'de');
}

/** Paketbeschreibung (`atrium-module.json`) eines registrierten Moduls, sofern vorhanden */
const packages = new Map<string, ModulePackage>();

/**
 * Prüft `def.package` gegen das Manifest: gleiche Kennung, Name, Beschreibung, Version, Abhängigkeiten und Rechte.
 * Wirft mit lesbarer Meldung; liefert das geprüfte Paket.
 */
function checkPackage(def: ModuleDefinition): ModulePackage | null {
	if (def.package === undefined) return null;
	const m = def.manifest;
	const pkg = parseModulePackage(def.package, `${m.id}/atrium-module.json`);
	const sameSet = (a: string[], b: string[]) =>
		a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
	const diffs: string[] = [];
	if (pkg.id !== m.id) diffs.push(`id ${pkg.id} ≠ ${m.id}`);
	if (!sameText(pkg.name, m.name)) diffs.push('name');
	if ((pkg.description ?? '') !== (m.description ?? '')) diffs.push('description');
	if (pkg.version !== m.version) diffs.push(`version ${pkg.version} ≠ ${m.version}`);
	if (!sameSet(Object.keys(pkg.dependencies), m.dependencies)) diffs.push('dependencies');
	if (!sameSet(Object.keys(pkg.optionalDependencies), m.optionalDependencies ?? []))
		diffs.push('optionalDependencies');
	if (!sameSet(pkg.permissions, m.permissions)) diffs.push('permissions');
	if (diffs.length) {
		throw new Error(
			`Modul ${m.id}: atrium-module.json passt nicht zum Manifest (${diffs.join(', ')})`
		);
	}
	return pkg;
}

export function validateDefinition(def: ModuleDefinition): void {
	const m = def.manifest;
	if (!MODULE_ID_PATTERN.test(m.id) || RESERVED_MODULE_IDS.has(m.id)) {
		throw new Error(`Ungültige Modul-ID: "${m.id}"`);
	}
	if (!/^\d+\.\d+\.\d+/.test(m.version)) {
		throw new Error(`Modul ${m.id}: Version muss SemVer sein`);
	}
	for (const p of m.permissions) {
		if (!PERMISSION_PATTERN.test(p) || !p.startsWith(`${m.id}.`)) {
			throw new Error(
				`Modul ${m.id}: Berechtigung "${p}" muss dem Schema ${m.id}.ressource.aktion folgen`
			);
		}
	}
	for (const s of def.settings ?? []) {
		if (!s.key.startsWith(`${m.id}.`)) {
			throw new Error(`Modul ${m.id}: Einstellung "${s.key}" muss mit "${m.id}." beginnen`);
		}
		if (s.secretBoundTo && (!s.secret || s.secretBoundTo.some((k) => !k.startsWith(`${m.id}.`)))) {
			throw new Error(`Modul ${m.id}: secretBoundTo von "${s.key}" nur für eigene Secrets`);
		}
	}
	for (const n of m.navigation) {
		if (!n.path.startsWith(`/modules/${m.id}`)) {
			throw new Error(`Modul ${m.id}: Navigationspfad muss unter /modules/${m.id} liegen`);
		}
	}
	const jobIds = new Set<string>();
	for (const j of def.jobs ?? []) {
		if (!/^[a-z][a-z0-9-]*$/.test(j.id) || jobIds.has(j.id)) {
			throw new Error(`Modul ${m.id}: ungültige oder doppelte Job-ID "${j.id}"`);
		}
		if (typeof j.schedule === 'object') {
			const n = j.schedule.everyMinutes;
			if (!Number.isInteger(n) || n < 1 || n > 60) {
				throw new Error(`Modul ${m.id}: Job "${j.id}" braucht everyMinutes zwischen 1 und 60`);
			}
		}
		jobIds.add(j.id);
	}
	for (const job of def.backup?.afterRestoreJobs ?? []) {
		if (!jobIds.has(job)) {
			throw new Error(`Modul ${m.id}: backup.afterRestoreJobs nennt unbekannten Job "${job}"`);
		}
	}
	if (def.backup?.adminOnlyRestore !== undefined && !def.backup.adminOnlyRestore.trim()) {
		throw new Error(`Modul ${m.id}: backup.adminOnlyRestore braucht einen Grund`);
	}
	if (def.principals) {
		if (!m.permissions.includes(def.principals.memberViewPermission)) {
			throw new Error(
				`Modul ${m.id}: principals.memberViewPermission "${def.principals.memberViewPermission}" fehlt im Manifest`
			);
		}
		if (!def.provides)
			throw new Error(`Modul ${m.id}: principals braucht provides (PrincipalProvider)`);
	}
	const agendaKinds = new Set<string>();
	for (const k of def.dashboard?.agendaKinds ?? []) {
		if (
			!AGENDA_KIND_PATTERN.test(k.key) ||
			agendaKinds.has(k.key) ||
			CORE_AGENDA_KINDS.some((c) => c.key === k.key) ||
			!k.label.trim() ||
			!DASHBOARD_AGENDA_STYLES.includes(k.style)
		) {
			throw new Error(`Modul ${m.id}: ungültige oder doppelte Dashboard-Art "${k.key}"`);
		}
		agendaKinds.add(k.key);
	}
	const officeKeys = new Set<string>();
	for (const o of m.offices ?? []) {
		if (!/^[a-z][a-z0-9-]*$/.test(o.key) || officeKeys.has(o.key) || !o.name.trim()) {
			throw new Error(`Modul ${m.id}: ungültige oder doppelte Amt-Vorlage "${o.key}"`);
		}
		officeKeys.add(o.key);
		const events = new Set<string>();
		for (const n of o.notifications) {
			if (!/^[a-z][a-z0-9-]*$/.test(n.key) || events.has(n.key)) {
				throw new Error(
					`Modul ${m.id}: ungültige oder doppelte Benachrichtigung "${o.key}.${n.key}"`
				);
			}
			events.add(n.key);
		}
	}
	const notificationKeys = new Set<string>();
	for (const t of def.notifications?.types ?? []) {
		if (!NOTIFICATION_KEY_PATTERN.test(t.key) || notificationKeys.has(t.key) || !t.label.trim()) {
			throw new Error(`Modul ${m.id}: ungültiger oder doppelter Benachrichtigungstyp "${t.key}"`);
		}
		const channel = t.defaultChannel ?? 'email';
		if (!allowedChannels(t).includes(channel) || (t.mandatory && t.pushOnly)) {
			throw new Error(
				`Modul ${m.id}: Benachrichtigungstyp "${t.key}" mit unzulässigem Standardkanal`
			);
		}
		for (const p of [...(t.permission ? [t.permission] : []), ...(t.anyPermission ?? [])]) {
			if (!m.permissions.includes(p)) {
				throw new Error(
					`Modul ${m.id}: Benachrichtigung "${t.key}" verlangt unbekanntes Recht "${p}"`
				);
			}
		}
		notificationKeys.add(t.key);
	}
	for (const dep of m.optionalDependencies ?? []) {
		if (dep === m.id || m.dependencies.includes(dep)) {
			throw new Error(`Modul ${m.id}: optionale Abhängigkeit "${dep}" ist ungültig`);
		}
	}
}

export function registerModule(def: ModuleDefinition): void {
	validateDefinition(def);
	const pkg = checkPackage(def);
	if (definitions.has(def.manifest.id)) {
		throw new Error(`Modul "${def.manifest.id}" ist bereits registriert`);
	}
	const otherSource = def.principals
		? [...definitions.values()].find((d) => d.principals)
		: undefined;
	if (otherSource) {
		throw new Error(
			`Modul "${def.manifest.id}": Personenquelle (principals) ist schon "${otherSource.manifest.id}"`
		);
	}
	definitions.set(def.manifest.id, def);
	broken.delete(def.manifest.id);
	if (pkg) packages.set(def.manifest.id, pkg);
}

export function unregisterModule(id: string): void {
	definitions.delete(id);
	packages.delete(id);
}

/** Modul, das Mitglieder/Gruppen für Freigaben liefert (`ModuleDefinition.principals`), sonst `null` */
export function principalSource(): { id: string; memberViewPermission: string } | null {
	for (const d of definitions.values()) {
		if (d.principals) return { id: d.manifest.id, ...d.principals };
	}
	return null;
}

export function getModulePackage(id: string): ModulePackage | undefined {
	return packages.get(id);
}

/** Merkt ein Modul als defekt (nicht geladen) – Anzeige unter Administration → Module */
export function markModuleBroken(entry: BrokenModuleEntry): void {
	broken.set(entry.id, entry);
	console.error(`[modules] Modul ${entry.id} nicht geladen: ${reasonText(entry.reason)}`);
}

/** Defekte Module mit Name und Grund in der Sprache des Requests */
export function brokenModules(): BrokenModule[] {
	return [...broken.values()]
		.map((b) => ({ ...b, name: localized(b.name), reason: reasonText(b.reason) }))
		.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Schließt Module aus, die nicht laufen können, statt den Start abzubrechen: Core-Version außerhalb von
 * `atrium-module.json` → `core`, harte Abhängigkeit fehlt/defekt oder in unpassender Version, Zyklus über harte
 * Abhängigkeiten. Wiederholt, bis nichts mehr wegfällt (Folgefehler werden mit erfasst).
 */
export function excludeUnresolvableModules(): BrokenModule[] {
	const removed: BrokenModule[] = [];
	const drop = (d: ModuleDefinition, key: string, params: MessageParams) => {
		const entry = { id: d.manifest.id, name: d.manifest.name, version: d.manifest.version };
		unregisterModule(d.manifest.id);
		markModuleBroken({ ...entry, reason: { key, params } });
		removed.push({ ...entry, name: localized(entry.name), reason: t(key, params) });
	};
	let changed = true;
	while (changed) {
		changed = false;
		for (const d of [...definitions.values()]) {
			const pkg = packages.get(d.manifest.id);
			if (pkg && !versionSatisfies(CORE_VERSION, pkg.core)) {
				drop(d, 'modules.broken.coreVersion', { range: pkg.core, version: CORE_VERSION });
				changed = true;
				continue;
			}
			for (const dep of d.manifest.dependencies) {
				const target = definitions.get(dep);
				const range = pkg?.dependencies[dep]?.version;
				const reason: [string, MessageParams] | null = !target
					? ['modules.broken.missingDependency', { dep }]
					: range && !versionSatisfies(target.manifest.version, range)
						? ['modules.broken.dependencyVersion', { dep, range, version: target.manifest.version }]
						: null;
				if (reason) {
					drop(d, ...reason);
					changed = true;
					break;
				}
			}
		}
	}
	// Zyklen über harte Abhängigkeiten: alle Beteiligten ausschließen
	const state = new Map<string, 'visiting' | 'done'>();
	const inCycle = new Set<string>();
	const visit = (id: string, trail: string[]) => {
		if (state.get(id) === 'done') return;
		if (state.get(id) === 'visiting') {
			for (const x of trail.slice(trail.indexOf(id))) inCycle.add(x);
			return;
		}
		state.set(id, 'visiting');
		for (const dep of definitions.get(id)?.manifest.dependencies ?? []) visit(dep, [...trail, id]);
		state.set(id, 'done');
	};
	for (const id of definitions.keys()) visit(id, []);
	for (const id of inCycle) {
		const d = definitions.get(id);
		if (d) drop(d, 'modules.broken.cycle', { ids: [...inCycle].join(', ') });
	}
	return removed;
}

/** Nur für Tests: Liste defekter Module leeren */
export function resetBrokenModulesForTests(): void {
	broken.clear();
}

export function getDefinition(id: string): ModuleDefinition | undefined {
	return definitions.get(id);
}

export function allDefinitions(): ModuleDefinition[] {
	return [...definitions.values()];
}

/**
 * Nach Zurücksetzen oder Wiederherstellen: Module verwerfen ihre Zwischenspeicher (`onDataReplaced`).
 * Fehler einzelner Module werden geloggt, nie weitergereicht.
 */
export async function notifyModuleDataReplaced(): Promise<void> {
	for (const d of definitions.values()) {
		if (!d.onDataReplaced) continue;
		try {
			await d.onDataReplaced();
		} catch (e) {
			console.warn(`[modules] onDataReplaced von ${d.manifest.id} fehlgeschlagen`, e);
		}
	}
}

export function requireDefinition(id: string): ModuleDefinition {
	const d = definitions.get(id);
	if (!d) throw errors.notFound(t('modules.notInstalled', { id }));
	return d;
}
