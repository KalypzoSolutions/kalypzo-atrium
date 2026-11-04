import type { RequestContext } from '$lib/sdk/types';

declare global {
	namespace App {
		interface Error {
			message: string;
			requestId?: string;
		}
		interface Locals {
			ctx: RequestContext;
			user: {
				id: string;
				name: string;
				email: string;
				image: string | null;
				twoFactorEnabled: boolean;
				mustChangePassword?: boolean;
			} | null;
			sessionId: string | null;
			/** Läuft „Als Person handeln“: Admin-Konto, Zielperson, Ablauf (sonst `null`) */
			impersonation: import('$lib/server/core/auth/context').ImpersonationInfo | null;
			requestId: string;
			/** Sprache des Requests (`core/i18n/locale.ts`) */
			locale: import('$lib/i18n').Locale;
		}
		interface PageState {
			/** Ebene offener Blätter (`BottomSheet`, Zurück-Geste schließt das oberste) */
			sheet?: number;
		}
	}
}

export {};
