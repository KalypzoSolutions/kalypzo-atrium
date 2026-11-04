import type { UserTheme } from '$lib/appearance/schema';

/** Form der Seitendaten (Vertrag mit `profile/+page.server.ts`, bewusst locker typisiert). */
export interface ProfileData {
	profile: {
		name: string;
		email: string;
		image?: string | null;
		twoFactorEnabled?: boolean | null;
	};
	roles: string[];
	createdAt: string | Date | null;
	/** Passwort von der Verwaltung gesetzt – erst selbst ändern */
	mustChangePassword?: boolean;
	/** Die Verwaltung handelt gerade als diese Person (Konto-Sicherheit gesperrt) */
	impersonating?: boolean;
	sessions: {
		id: string;
		current: boolean;
		ipAddress: string | null;
		userAgent: string | null;
		createdAt: string | Date;
	}[];
	apiKeys?: { id?: string; name: string; prefix: string; lastUsedAt: string | Date | null }[];
	settings: {
		theme: string;
		accentColor?: string;
		density?: string;
		startPage?: string;
		pageSize: number;
		/** Eigene Sprache (`''` = wie das System) */
		locale?: string;
	};
	themes: {
		own: UserTheme[];
		presets: readonly UserTheme[];
		activeId: string;
		/** Mit Stern markierte Theme-IDs (Schnellwahl in der Kopfzeile) */
		favorites: string[];
	};
	permissions: string[];
	startPageOptions: { value: string; label: string }[];
}
