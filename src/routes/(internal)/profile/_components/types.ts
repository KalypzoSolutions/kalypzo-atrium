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
	};
	permissions: string[];
	startPageOptions: { value: string; label: string }[];
}
