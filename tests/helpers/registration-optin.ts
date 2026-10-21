/**
 * Double-Opt-in des Anmeldelinks (Modul `actions`, Issue #17) in Tests: Anonyme Anmeldungen
 * werden erst mit dem Link aus der Bestätigungs-Mail gültig. Diese Hilfen holen den Token aus der
 * abgefangenen Mail und bestätigen – für Tests, die das frühere „Anmelden = sofort Teilnehmer*in“
 * voraussetzen (Kasse, Gesundheitsdaten …).
 */
import { resetAllForTests } from '$lib/server/core/rate-limit';

/** Pfad der Bestätigungsseite inkl. Token aus einem Mailtext */
const TOKEN_RE = /\/p\/actions\/anmeldung-bestaetigen\/([0-9a-f]{64})/;

export function optInToken(text: string): string | null {
	return TOKEN_RE.exec(text)?.[1] ?? null;
}

type Api = (path: string, init?: { method?: string; json?: unknown }) => Promise<Response>;

/**
 * Antwort einer Anmeldung auswerten: Ist eine Bestätigung nötig, wird die Bitte um Bestätigung aus
 * `mails` entfernt (Altverhalten: nur die Anmeldebestätigung bleibt) und die Anmeldung über
 * `POST /modules/actions/public/registrations/:token/confirm` bestätigt. Liefert eine Antwort im
 * Format der Einreichung (201) bzw. die ursprüngliche Antwort bei Fehlern oder ohne Mail.
 */
export async function confirmIfNeeded(
	res: Response,
	mails: { text: string }[],
	api: Api,
	mailsBefore = 0
): Promise<Response> {
	if (res.status !== 201) return res;
	const body = (await res.clone().json()) as { data: Record<string, unknown> };
	if (!body.data?.confirmationRequired) return res;
	let token: string | null = null;
	for (let i = mails.length - 1; i >= mailsBefore; i--) {
		token = optInToken(mails[i]!.text);
		if (token) {
			mails.splice(i, 1);
			break;
		}
	}
	// Keine Mail (z. B. Honeypot-Antwort): unverändert zurück
	if (!token) return res;
	resetAllForTests();
	const confirmed = await api(`/modules/actions/public/registrations/${token}/confirm`, {
		method: 'POST',
		json: {}
	});
	if (confirmed.status !== 201) return confirmed;
	const c = (await confirmed.json()) as { data: Record<string, unknown> };
	return new Response(
		JSON.stringify({ data: { ...body.data, ...c.data, confirmationRequired: true } }),
		{ status: 201, headers: { 'content-type': 'application/json' } }
	);
}
