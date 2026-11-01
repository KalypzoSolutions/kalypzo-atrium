import { isAbsolute } from 'node:path';
import { z } from 'zod';

/** Platzhalter aus dem `Dockerfile` (Build-Stufe) – darf im Betrieb nie als Geheimnis dienen. */
export const BUILD_PLACEHOLDER_SECRET = 'build-time-placeholder-build-time-placeholder';
/** Mindestanzahl verschiedener Zeichen in `APP_SECRET` im Produktivbetrieb (fängt `aaaa…`/`abab…` ab). */
const MIN_SECRET_DISTINCT_CHARS = 6;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const schema = z.object({
	NODE_ENV: z.string().optional(),
	DATABASE_URL: z.string().min(1).default('postgres://localhost/ep_intern'),
	/** Hauptgeheimnis für die Verschlüsselung von Secrets und Auth-Signaturen (min. 32 Zeichen) */
	APP_SECRET: z.string().min(32, 'APP_SECRET muss mindestens 32 Zeichen lang sein'),
	ORIGIN: z.string().url().default('http://localhost:5173'),
	INITIAL_ADMIN_EMAIL: z.string().email().optional(),
	INITIAL_ADMIN_PASSWORD: z.string().min(12).optional(),
	/** Maximale Verbindungen im Pool (1 für Einzelsitzungs-Datenbanken wie PGlite) */
	DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
	/** `pglite` wird nur für Tests verwendet */
	DATABASE_DRIVER: z.enum(['pg', 'pglite']).default('pg'),
	/** Temp-Verzeichnis der Datensicherung (Plattenvolume, nicht der RAM-tmpfs `/tmp`), absolut */
	BACKUP_TMP_DIR: z
		.string()
		.refine((v) => isAbsolute(v), 'BACKUP_TMP_DIR muss ein absoluter Pfad sein')
		.optional(),
	/** Größte hochladbare Sicherungsdatei in Byte (gelesen in `backup/uploads.ts`) */
	BACKUP_MAX_BYTES: z.coerce.number().int().positive().optional(),
	/**
	 * Chromium-Sandbox des PDF-Renderers (#67, 01a-13): `on` = immer mit Sandbox (Start schlägt sonst fehl),
	 * `off` = immer `--no-sandbox`, `auto` = erst mit Sandbox, bei Startfehler einmalig ohne (mit Warnung im Log).
	 */
	PDF_CHROMIUM_SANDBOX: z.enum(['auto', 'on', 'off']).default('auto'),
	/**
	 * Faktor auf alle Auth-Rate-Limits (`auth/auth-limits.ts`, Standard 1). Höher nur, wenn viele Personen
	 * hinter derselben IP arbeiten (NAT) oder für E2E-Tests; die Fehlversuchssperre je Konto bleibt unverändert.
	 */
	AUTH_RATE_LIMIT_FACTOR: z.coerce.number().int().min(1).max(100).default(1),
	/**
	 * Modul-Installation im Panel (Kalypzo Atrium): `off` = nur Vorschau, `copy` = Dateien direkt ins Modulverzeichnis
	 * (Entwicklung mit `vite dev`, danach lädt Vite neu), `supervisor` = Neubau über den Supervisor (Phase 6).
	 * Ohne Angabe: `copy` bei `NODE_ENV=development`, sonst `off`.
	 */
	ATRIUM_MODULE_INSTALL: z.enum(['off', 'copy', 'supervisor']).optional()
});

export type Env = z.infer<typeof schema>;

/**
 * Zusatzregeln für den Produktivbetrieb (`NODE_ENV=production`, gesetzt im `Dockerfile`):
 * `ORIGIN` muss ausdrücklich gesetzt sein und `https://` verwenden (außer localhost, z. B. Demo/E2E),
 * `APP_SECRET` darf nicht der Build-Platzhalter oder trivial sein.
 */
const productionSchema = schema.superRefine((v, ctx) => {
	if (v.NODE_ENV !== 'production') return;
	let origin: URL | undefined;
	try {
		origin = new URL(v.ORIGIN);
	} catch {
		return; // Formatfehler meldet bereits `z.string().url()`
	}
	if (origin.protocol !== 'https:' && !LOCAL_HOSTS.has(origin.hostname)) {
		ctx.addIssue({
			code: 'custom',
			path: ['ORIGIN'],
			message:
				'ORIGIN muss im Produktivbetrieb mit https:// beginnen (sonst fehlt das Secure-Flag der Cookies)'
		});
	}
	if (v.APP_SECRET === BUILD_PLACEHOLDER_SECRET) {
		ctx.addIssue({
			code: 'custom',
			path: ['APP_SECRET'],
			message:
				'APP_SECRET ist noch der Build-Platzhalter – zufälligen Wert setzen (openssl rand -base64 48)'
		});
	} else if (
		typeof v.APP_SECRET === 'string' &&
		new Set(v.APP_SECRET).size < MIN_SECRET_DISTINCT_CHARS
	) {
		ctx.addIssue({
			code: 'custom',
			path: ['APP_SECRET'],
			message: 'APP_SECRET ist zu einfach – zufälligen Wert setzen (openssl rand -base64 48)'
		});
	}
});

/** Prüft eine Umgebung (für Tests ohne Cache); wirft mit allen Fehlern in einer Meldung. */
export function parseEnv(input: Record<string, string | undefined>): Env {
	// Compose reicht nicht gesetzte Variablen als leeren String durch: leer == nicht gesetzt
	const source = Object.fromEntries(
		Object.entries(input).filter(([, v]) => v !== undefined && v.trim() !== '')
	);
	const parsed = productionSchema.safeParse(source);
	const problems = parsed.success
		? []
		: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
	if (source.NODE_ENV === 'production' && !('ORIGIN' in source)) {
		problems.push('ORIGIN: ORIGIN muss im Produktivbetrieb gesetzt sein');
	}
	if (!parsed.success || problems.length > 0) {
		throw new Error('Ungültige Umgebungsvariablen: ' + problems.join('; '));
	}
	return parsed.data;
}

let cached: Env | undefined;

export function env(): Env {
	if (!cached) cached = parseEnv(process.env);
	return cached;
}

export function resetEnvForTests(): void {
	cached = undefined;
}
