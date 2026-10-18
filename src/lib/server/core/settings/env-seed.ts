import { and, eq } from 'drizzle-orm';
import { systemContext } from '../auth/context';
import { getDb, schema } from '../database/client';
import { setSetting } from './service';

/**
 * Vorbelegung ausgewählter Einstellungen aus Umgebungsvariablen (Container-/Dokploy-Betrieb).
 *
 * Regel: Ein Wert wird nur gesetzt, wenn die Einstellung noch NICHT in der Datenbank steht. Spätere
 * Änderungen in der Oberfläche bleiben also erhalten und werden beim Neustart nicht überschrieben.
 */
const MAPPING: { env: string; key: string; parse?: (v: string) => unknown }[] = [
	{ env: 'S3_ENDPOINT', key: 'core.storage.endpoint' },
	{ env: 'S3_REGION', key: 'core.storage.region' },
	{ env: 'S3_BUCKET', key: 'core.storage.bucket' },
	{ env: 'S3_ACCESS_KEY_ID', key: 'core.storage.accessKeyId' },
	{ env: 'S3_SECRET_ACCESS_KEY', key: 'core.storage.secretAccessKey' },
	{ env: 'S3_FORCE_PATH_STYLE', key: 'core.storage.forcePathStyle', parse: bool },
	{ env: 'SMTP_HOST', key: 'core.smtp.host' },
	{ env: 'SMTP_PORT', key: 'core.smtp.port', parse: (v) => Number(v) },
	{ env: 'SMTP_SECURE', key: 'core.smtp.secure', parse: bool },
	{ env: 'SMTP_USER', key: 'core.smtp.user' },
	{ env: 'SMTP_PASSWORD', key: 'core.smtp.password' },
	{ env: 'SMTP_FROM', key: 'core.smtp.from' }
];

function bool(v: string): boolean {
	return /^(1|true|yes|ja|on)$/i.test(v.trim());
}

/** Gibt die Schlüssel zurück, die gesetzt wurden (für Log/Tests; nie Werte). */
export async function seedSettingsFromEnv(
	source: Record<string, string | undefined> = process.env
): Promise<string[]> {
	const applied: string[] = [];
	const ctx = systemContext('env-seed');
	for (const m of MAPPING) {
		const raw = source[m.env]?.trim();
		if (!raw) continue;
		const [existing] = await getDb()
			.select({ key: schema.setting.key })
			.from(schema.setting)
			.where(and(eq(schema.setting.key, m.key), eq(schema.setting.scopeId, '')));
		if (existing) continue;
		try {
			await setSetting(ctx, m.key, m.parse ? m.parse(raw) : raw);
			applied.push(m.key);
		} catch (e) {
			console.warn(
				`[core] Umgebungsvariable ${m.env} ungültig und ignoriert:`,
				(e as Error).message
			);
		}
	}
	return applied;
}
