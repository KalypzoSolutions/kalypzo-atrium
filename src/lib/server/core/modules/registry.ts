import { PERMISSION_PATTERN } from '../permissions/catalog';
import { errors } from '../errors';
import { NOTIFICATION_KEY_PATTERN, allowedChannels } from '$lib/sdk/types/notifications';
import { MODULE_ID_PATTERN, RESERVED_MODULE_IDS, type ModuleDefinition } from './types';

/**
 * Build-Zeit-Registrierung. Hier wird nur bekannt gemacht, WELCHE Module im Build enthalten
 * sind. Ob ein Modul laufzeitseitig aktiv ist, entscheidet `module_state` (siehe state.ts).
 */
const definitions = new Map<string, ModuleDefinition>();

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
	if (definitions.has(def.manifest.id)) {
		throw new Error(`Modul "${def.manifest.id}" ist bereits registriert`);
	}
	definitions.set(def.manifest.id, def);
}

export function unregisterModule(id: string): void {
	definitions.delete(id);
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

/** Topologische Prüfung: unbekannte Abhängigkeiten und Zyklen werden abgelehnt. */
export function assertDependenciesResolvable(): void {
	for (const d of definitions.values()) {
		for (const dep of d.manifest.dependencies) {
			if (!definitions.has(dep)) {
				throw new Error(`Modul ${d.manifest.id} benötigt unbekanntes Modul "${dep}"`);
			}
		}
	}
	const visiting = new Set<string>();
	const done = new Set<string>();
	const visit = (id: string, trail: string[]) => {
		if (done.has(id)) return;
		if (visiting.has(id))
			throw new Error(`Zyklische Modulabhängigkeit: ${[...trail, id].join(' -> ')}`);
		visiting.add(id);
		for (const dep of definitions.get(id)?.manifest.dependencies ?? []) visit(dep, [...trail, id]);
		visiting.delete(id);
		done.add(id);
	};
	for (const id of definitions.keys()) visit(id, []);
}

export function requireDefinition(id: string): ModuleDefinition {
	const d = definitions.get(id);
	if (!d) throw errors.notFound(`Modul "${id}" ist nicht installiert`);
	return d;
}
