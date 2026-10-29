/**
 * Konfiguration einer Textstelle für die Schreibhilfe und reaktiver Zugriff auf ihren Status.
 * Der Knopf erscheint nur, wenn der Server die Textstelle für die Person freigibt.
 */
import type { AssistContextRef, AssistPurposeInfo, AssistStatus } from '$lib/sdk/types';
import { assistStatus } from '$lib/sdk/client/assist';

export interface AssistConfig {
	/** Modul, dem die Textstelle gehört (Recht `<modul>.ai.use`) */
	module: string;
	/** Zweck-ID aus `ModuleDefinition.assist.purposes` */
	purpose: string;
	/** Objekt, aus dem der Server Eckdaten holt (z. B. `{ module: 'actions', kind: 'action', id }`) */
	context?: AssistContextRef;
	/** Ungespeicherte Formularwerte (der Server übernimmt nur die freigegebenen Schlüssel) */
	extra?: () => Record<string, string | null | undefined>;
}

export interface AssistHandle {
	readonly info: AssistPurposeInfo | null;
	readonly status: AssistStatus | null;
}

/** Status einer Textstelle; `info` bleibt `null`, solange sie nicht verfügbar ist */
export function assistPurpose(config: () => AssistConfig | undefined): AssistHandle {
	let status = $state<AssistStatus | null>(null);
	void assistStatus().then((s) => (status = s));
	const info = $derived.by(() => {
		const c = config();
		if (!c || !status?.configured) return null;
		return status.purposes[`${c.module}:${c.purpose}`] ?? null;
	});
	return {
		get info() {
			return info;
		},
		get status() {
			return status;
		}
	};
}

/** `extra` ohne leere Werte */
export function extraValues(config: AssistConfig): Record<string, string> | undefined {
	const raw = config.extra?.();
	if (!raw) return undefined;
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(raw)) if (v && v.trim()) out[k] = v.trim();
	return Object.keys(out).length ? out : undefined;
}
