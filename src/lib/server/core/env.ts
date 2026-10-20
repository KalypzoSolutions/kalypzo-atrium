import { z } from 'zod';

const schema = z.object({
	DATABASE_URL: z.string().min(1).default('postgres://localhost/ep_intern'),
	/** Hauptgeheimnis für die Verschlüsselung von Secrets und Auth-Signaturen (min. 32 Zeichen) */
	APP_SECRET: z.string().min(32, 'APP_SECRET muss mindestens 32 Zeichen lang sein'),
	ORIGIN: z.string().url().default('http://localhost:5173'),
	INITIAL_ADMIN_EMAIL: z.string().email().optional(),
	INITIAL_ADMIN_PASSWORD: z.string().min(12).optional(),
	/** Maximale Verbindungen im Pool (1 für Einzelsitzungs-Datenbanken wie PGlite) */
	DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
	/** `pglite` wird nur für Tests verwendet */
	DATABASE_DRIVER: z.enum(['pg', 'pglite']).default('pg')
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
	if (!cached) {
		// Compose reicht nicht gesetzte Variablen als leeren String durch: leer == nicht gesetzt
		const source = Object.fromEntries(
			Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== '')
		);
		const parsed = schema.safeParse(source);
		if (!parsed.success) {
			throw new Error(
				'Ungültige Umgebungsvariablen: ' +
					parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
			);
		}
		cached = parsed.data;
	}
	return cached;
}

export function resetEnvForTests(): void {
	cached = undefined;
}
