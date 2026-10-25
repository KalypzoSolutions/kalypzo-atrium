/**
 * Benachrichtigungen (Core-Dienst `core.notifications`) – Typen und Konstanten für Client und Server.
 *
 * Jede Person wählt je Benachrichtigungstyp einen Kanal: Aus · E-Mail · Beides · Push. Module deklarieren
 * ihre Typen in `ModuleDefinition.notifications` und senden über `core.notifications.send`.
 */

export const NOTIFICATION_CHANNELS = ['off', 'email', 'both', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_DELIVERIES = ['immediate', 'daily'] as const;
export type NotificationDelivery = (typeof NOTIFICATION_DELIVERIES)[number];

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
	off: 'Aus',
	email: 'E-Mail',
	both: 'Beides',
	push: 'Push'
};

/** Schlüssel eines Typs innerhalb des Moduls (vollständig: `<modul>.<key>`) */
export const NOTIFICATION_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
/** Vollständiger Schlüssel `<modul>.<key>` */
export const NOTIFICATION_TYPE_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
export const NOTIFICATION_SCOPE_MAX = 200;
export const NOTIFICATION_TITLE_MAX = 150;
export const NOTIFICATION_BODY_MAX = 4000;
/** Höchstzahl registrierter Geräte je Person */
export const PUSH_DEVICES_MAX = 10;

/** Benachrichtigungstyp, den ein Modul deklariert */
export interface ModuleNotificationType {
	/** `[a-z][a-z0-9-]*`, vollständig `<modul>.<key>` */
	key: string;
	label: string;
	description?: string;
	/** Kanal ohne eigene Wahl der Person (Standard `email`) */
	defaultChannel?: NotificationChannel;
	/** Nicht abschaltbar (mindestens E-Mail oder Push), z. B. Sicherheitshinweise */
	mandatory?: boolean;
	/** „Täglich (Zusammenfassung)“ wählbar */
	digest?: boolean;
	/**
	 * Nur Push: die E-Mail verschickt das Modul selbst an andere Adressen (z. B. Kasse an
	 * Mitglieder-Kontakte). Wählbar sind nur Aus und Push; kein Rückfall auf E-Mail.
	 */
	pushOnly?: boolean;
	/**
	 * Gilt je Bereich (z. B. je Postfach oder Amt): erscheint im Profil nur über
	 * `ModuleNotifications.forUser`, beim Senden ist `scope` Pflicht.
	 */
	scoped?: boolean;
	/** Sichtbarkeit im Profil (nicht für `scoped`) */
	permission?: string;
	anyPermission?: string[];
}

/** Eintrag für einen Bereich eines `scoped`-Typs (aus `forUser`) */
export interface NotificationScopeEntry {
	/** Schlüssel des deklarierten Typs (ohne Modul) */
	key: string;
	/** z. B. Postfach-Schlüssel; ≤ 200 Zeichen */
	scope: string;
	label: string;
	description?: string;
	/** Zwischenüberschrift im Profil (z. B. Name des Amts/Postfachs) */
	group?: string;
}

/** Zeile in den Profil-Einstellungen */
export interface NotificationPrefItem {
	/** `<modul>.<key>` */
	type: string;
	scope: string;
	label: string;
	description: string | null;
	group: string | null;
	channel: NotificationChannel;
	delivery: NotificationDelivery;
	defaultChannel: NotificationChannel;
	mandatory: boolean;
	digest: boolean;
	pushOnly: boolean;
}

export interface NotificationPrefGroup {
	/** Modul-ID oder `core` */
	id: string;
	label: string;
	items: NotificationPrefItem[];
}

export interface PushDevice {
	id: string;
	label: string;
	createdAt: string;
	lastSuccessAt: string | null;
}

export interface NotificationPrefsResponse {
	/** Push ist systemweit eingeschaltet und eingerichtet */
	pushAvailable: boolean;
	devices: PushDevice[];
	groups: NotificationPrefGroup[];
}

/** Erlaubte Kanäle eines Typs (für Regler und Server-Prüfung) */
export function allowedChannels(t: {
	mandatory?: boolean;
	pushOnly?: boolean;
}): NotificationChannel[] {
	if (t.pushOnly) return ['off', 'push'];
	if (t.mandatory) return ['email', 'both', 'push'];
	return [...NOTIFICATION_CHANNELS];
}
