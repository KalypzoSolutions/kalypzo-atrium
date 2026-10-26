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
			} | null;
			sessionId: string | null;
			requestId: string;
		}
		interface PageState {
			/** Ebene offener Blätter (`BottomSheet`, Zurück-Geste schließt das oberste) */
			sheet?: number;
		}
	}
}

export {};
