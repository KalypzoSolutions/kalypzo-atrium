/**
 * Typen der KI-Schreibhilfe (Client + Server). Module melden ihre Textstellen („Zwecke“) in
 * `ModuleDefinition.assist` an; die Oberfläche ruft `POST /api/v1/ai/assist` (SSE) auf.
 */

/** Was die Schreibhilfe mit dem Text tun soll */
export type AssistTask =
	| 'draft'
	| 'rewrite'
	| 'friendly'
	| 'shorter'
	| 'simple'
	| 'spelling'
	| 'english'
	| 'subject'
	| 'title'
	| 'teaser'
	| 'alt-text'
	| 'split'
	| 'packing-list'
	| 'summarize'
	| 'continue'
	| 'todos';

export const ASSIST_TASKS: readonly AssistTask[] = [
	'draft',
	'rewrite',
	'friendly',
	'shorter',
	'simple',
	'spelling',
	'english',
	'subject',
	'title',
	'teaser',
	'alt-text',
	'split',
	'packing-list',
	'summarize',
	'continue',
	'todos'
];

/** Aufgaben, die mehrere kurze Vorschläge liefern (Betreff, Titel …) */
export const ASSIST_VARIANT_TASKS: readonly AssistTask[] = ['subject', 'title', 'teaser'];
/** Aufgaben, die eine Liste von Einträgen liefern (Unteraufgaben, Packliste) */
export const ASSIST_LIST_TASKS: readonly AssistTask[] = ['split', 'packing-list', 'todos'];

/** Beschriftung der Aufgaben in der Oberfläche */
export const ASSIST_TASK_LABELS: Record<AssistTask, string> = {
	draft: 'Entwurf schreiben',
	rewrite: 'Nach Wunsch ändern',
	friendly: 'Freundlicher',
	shorter: 'Kürzer',
	simple: 'Einfache Sprache',
	spelling: 'Rechtschreibung',
	english: 'Englisch',
	subject: 'Betreff vorschlagen',
	title: 'Titel vorschlagen',
	teaser: 'Kurztext vorschlagen',
	'alt-text': 'Bild beschreiben',
	split: 'In Schritte zerlegen',
	'packing-list': 'Packliste vorschlagen',
	summarize: 'Zusammenfassen',
	continue: 'Weiterschreiben',
	todos: 'Aufgaben ableiten'
};

/** Standard-Aufgaben für Fließtext */
export const ASSIST_TEXT_TASKS: AssistTask[] = [
	'draft',
	'rewrite',
	'friendly',
	'shorter',
	'simple',
	'spelling',
	'english'
];

/** `rich` = einfaches HTML wie im `RichTextEditor`, `plain` = reiner Text */
export type AssistFormat = 'rich' | 'plain';

/** Anrede in Texten an Eltern/Mitglieder */
export type AssistAddress = 'du' | 'ihr' | 'Sie';
export const ASSIST_ADDRESSES: readonly AssistAddress[] = ['du', 'ihr', 'Sie'];

/** Verweis auf ein Objekt, aus dem der Server Eckdaten holt (z. B. eine Aktion) */
export interface AssistContextRef {
	/** Modul, das den Kontext liefert, z. B. `actions` */
	module: string;
	/** Art im Modul, z. B. `action` */
	kind: string;
	id: string;
}

export interface AssistRequest {
	/** Modul, dem die Textstelle gehört (Recht `<modul>.ai.use`) */
	module: string;
	/** Zweck-ID aus `ModuleDefinition.assist.purposes` */
	purpose: string;
	task: AssistTask;
	/** Aktueller Text des Feldes (HTML bei `rich`) */
	text: string;
	/** Zusätzlicher Wunsch der Person */
	instruction?: string;
	address?: AssistAddress;
	context?: AssistContextRef;
	/** Werte aus dem noch ungespeicherten Formular (Server übernimmt nur `extraKeys` des Zwecks) */
	extra?: Record<string, string>;
}

export type AssistCheckLevel = 'ok' | 'warning';

export interface AssistCheck {
	level: AssistCheckLevel;
	message: string;
}

export interface AssistResult {
	/** Vorschlag (HTML bei `rich`, sonst Text); leer bei Varianten/Listen */
	text: string;
	/** Kurze Alternativen (Betreff, Titel, Kurztext) */
	variants?: string[];
	/** Einträge (Unteraufgaben, Packliste) */
	items?: string[];
	checks: AssistCheck[];
	/** Eckdaten, die die KI bekommen hat (Anzeige im Blatt) */
	facts: Record<string, string>;
	tokens: number;
}

/** Ereignisse im SSE-Strom von `POST /ai/assist` */
export type AssistEvent =
	| { type: 'delta'; text: string }
	| ({ type: 'done' } & AssistResult)
	| { type: 'error'; message: string; code?: string };

/** Öffentliche Angaben zu einer Textstelle (für die Oberfläche) */
export interface AssistPurposeInfo {
	label: string;
	format: AssistFormat;
	tasks: AssistTask[];
	maxChars: number;
	letter: boolean;
}

/** Antwort von `GET /ai/assist/status` */
export interface AssistStatus {
	/** KI-Dienst eingerichtet (API-Schlüssel vorhanden) */
	configured: boolean;
	/** Module, in denen die Person die Schreibhilfe nutzen darf */
	modules: string[];
	/** Textstellen dieser Module, Schlüssel `<modul>:<zweck>` */
	purposes: Record<string, AssistPurposeInfo>;
	allowInbox: boolean;
	allowImages: boolean;
	address: AssistAddress;
}
