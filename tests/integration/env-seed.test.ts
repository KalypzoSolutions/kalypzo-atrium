import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/db';
import { systemContext } from '$lib/server/core/auth/context';
import { getSetting, setSetting, setSettings } from '$lib/server/core/settings/service';
import { seedSettingsFromEnv } from '$lib/server/core/settings/env-seed';

beforeAll(async () => {
	await useTestDatabase();
});

describe('Einstellungen aus der Umgebung', () => {
	it('setzt nur fehlende Einstellungen und überschreibt keine Änderungen', async () => {
		const env = {
			S3_ENDPOINT: 'http://minio:9000',
			S3_BUCKET: 'ep-intern',
			S3_ACCESS_KEY_ID: 'key',
			S3_SECRET_ACCESS_KEY: 'secret-value',
			S3_FORCE_PATH_STYLE: 'true',
			SMTP_PORT: '2525',
			SMTP_HOST: ''
		};
		const first = await seedSettingsFromEnv(env);
		expect(first).toContain('core.storage.bucket');
		expect(first).toContain('core.storage.secretAccessKey');
		expect(first).not.toContain('core.smtp.host');
		expect(await getSetting('core.storage.endpoint')).toBe('http://minio:9000');
		expect(await getSetting('core.storage.forcePathStyle')).toBe(true);
		expect(await getSetting('core.storage.secretAccessKey')).toBe('secret-value');
		expect(await getSetting('core.smtp.port')).toBe(2525);

		// Änderung in der Oberfläche bleibt beim nächsten Start erhalten
		await setSetting(systemContext('test'), 'core.storage.bucket', 'anderer-bucket');
		const second = await seedSettingsFromEnv(env);
		expect(second).toEqual([]);
		expect(await getSetting('core.storage.bucket')).toBe('anderer-bucket');
	});

	it('ignoriert ungültige Werte, ohne zu werfen', async () => {
		const applied = await seedSettingsFromEnv({ S3_ENDPOINT: 'kein-url' });
		expect(applied).not.toContain('core.storage.endpoint');
	});

	it('übernimmt S3_PREFIX und prüft den Unterpfad', async () => {
		const applied = await seedSettingsFromEnv({ S3_PREFIX: 'atrium/prod' });
		expect(applied).toContain('core.storage.prefix');
		expect(await getSetting('core.storage.prefix')).toBe('atrium/prod');

		const ctx = systemContext('test');
		await setSettings(ctx, { 'core.storage.prefix': '/kunden/a_1/' });
		expect(await getSetting('core.storage.prefix')).toBe('/kunden/a_1/');
		for (const bad of ['../x', 'a/./b', 'mit leerzeichen', 'ä']) {
			await expect(setSettings(ctx, { 'core.storage.prefix': bad })).rejects.toMatchObject({
				code: 'validation_failed'
			});
		}
	});
});
