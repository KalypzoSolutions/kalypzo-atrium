import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/core/settings/service', () => ({
	getSettings: async () => ({}),
	getSetting: async () => undefined
}));
vi.mock('$lib/server/core/storage', () => ({
	upload: async () => null,
	readFileByIdUnchecked: async () => null
}));

import { chromiumLaunchAttempts } from '$lib/server/core/pdf';
import { parseEnv } from '$lib/server/core/env';

// #67 (01a-13): `--no-sandbox` nur noch per Schalter bzw. als protokollierter Rückfall.
describe('Chromium-Sandbox des PDF-Renderers', () => {
	it('on: nur mit Sandbox, nie --no-sandbox', () => {
		const attempts = chromiumLaunchAttempts('on');
		expect(attempts).toHaveLength(1);
		expect(attempts[0]!.chromiumSandbox).toBe(true);
		expect(attempts[0]!.args).not.toContain('--no-sandbox');
	});

	it('off: ausdrücklich ohne Sandbox', () => {
		const attempts = chromiumLaunchAttempts('off');
		expect(attempts).toEqual([
			{ chromiumSandbox: false, args: ['--disable-dev-shm-usage', '--no-sandbox'] }
		]);
	});

	it('auto: zuerst mit Sandbox, dann Rückfall', () => {
		const attempts = chromiumLaunchAttempts('auto');
		expect(attempts.map((a) => a.chromiumSandbox)).toEqual([true, false]);
		expect(attempts[0]!.args).not.toContain('--no-sandbox');
	});

	it('Standard der Umgebung ist auto, ungültige Werte werden abgelehnt', () => {
		const base = { APP_SECRET: 'x'.repeat(16) + 'abcdefghijklmnop' };
		expect(parseEnv(base).PDF_CHROMIUM_SANDBOX).toBe('auto');
		expect(parseEnv({ ...base, PDF_CHROMIUM_SANDBOX: 'on' }).PDF_CHROMIUM_SANDBOX).toBe('on');
		expect(() => parseEnv({ ...base, PDF_CHROMIUM_SANDBOX: 'yes' })).toThrow(
			/PDF_CHROMIUM_SANDBOX/
		);
	});
});
