import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ctxWith, settingsStore, systemCtx } from './_helpers';

vi.mock('$lib/server/core/settings/service', () => ({
	getSettings: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settingsStore[k]])),
	getSetting: async (k: string) => settingsStore[k]
}));
const download = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/core/storage', () => ({ download }));

import * as ai from '$lib/server/core/ai';
import type { AiChatParams, AiClient, UsageRow } from '$lib/server/core/ai';
import { resetAllForTests } from '$lib/server/core/rate-limit';

let calls: AiChatParams[];
let responses: string[];
let failWith: unknown;
let recorded: UsageRow[];
let monthTotals: { tokens: number; costUsd: number };

const fakeClient: AiClient = {
	async complete(p) {
		calls.push(p);
		if (failWith) throw failWith;
		return { text: responses.shift() ?? 'ok', inputTokens: 100, outputTokens: 50 };
	},
	async *stream(p) {
		calls.push(p);
		yield { delta: 'Hal' };
		yield { delta: 'lo' };
		yield { usage: { inputTokens: 10, outputTokens: 2 } };
	}
};

beforeEach(() => {
	calls = [];
	responses = [];
	failWith = undefined;
	recorded = [];
	monthTotals = { tokens: 0, costUsd: 0 };
	resetAllForTests();
	download.mockReset();
	Object.assign(settingsStore, {
		'core.ai.apiKey': 'sk-test',
		'core.ai.baseUrl': '',
		'core.ai.defaultModel': 'gpt-default',
		'core.ai.allowedModels': [],
		'core.ai.allowedModules': [],
		'core.ai.monthlyTokenLimit': 0,
		'core.ai.monthlyCostLimitUsd': 0,
		'core.ai.requestsPerMinute': 60,
		'core.ai.pricing': { 'gpt-default': { input: 1, output: 2 } }
	});
	ai.setOpenAiClientFactoryForTests(() => fakeClient);
	ai.setUsageRepoForTests({
		async record(r) {
			recorded.push(r);
		},
		async totals() {
			return monthTotals;
		},
		async totalsForActor() {
			return 0;
		},
		async summary() {
			return [];
		}
	});
});

const ctx = () => ctxWith('members.ai.use');
const base = { module: 'members', prompt: 'x' };

describe('AI-Service', () => {
	it('verwendet das Standardmodell und erfasst Nutzung und Kosten', async () => {
		const res = await ai.generate(ctx(), { ...base, prompt: 'Hi', model: 'configured-default' });
		expect(calls[0]!.model).toBe('gpt-default');
		expect(res.usage).toMatchObject({ inputTokens: 100, outputTokens: 50 });
		expect(res.usage.estimatedCostUsd).toBeCloseTo((100 * 1 + 50 * 2) / 1e6, 10);
		expect(recorded).toHaveLength(1);
		expect(recorded[0]).toMatchObject({ moduleId: 'members', model: 'gpt-default' });
		expect(JSON.stringify(recorded[0])).not.toContain('"Hi"');
	});

	it('erzwingt Berechtigung, Modulfreigabe und Modellliste', async () => {
		await expect(ai.generate(ctxWith(), base)).rejects.toMatchObject({ code: 'forbidden' });
		await expect(ai.generate(systemCtx, base)).resolves.toBeTruthy();
		settingsStore['core.ai.allowedModules'] = ['other'];
		await expect(ai.generate(ctx(), base)).rejects.toMatchObject({ code: 'forbidden' });
		settingsStore['core.ai.allowedModules'] = [];
		settingsStore['core.ai.allowedModels'] = ['gpt-x'];
		await expect(ai.generate(ctx(), { ...base, model: 'gpt-y' })).rejects.toMatchObject({
			code: 'bad_request'
		});
	});

	it('meldet fehlenden API-Key', async () => {
		settingsStore['core.ai.apiKey'] = '';
		await expect(ai.generate(ctx(), base)).rejects.toMatchObject({ code: 'unavailable' });
	});

	it('wendet Rate Limit und Monatslimits an', async () => {
		settingsStore['core.ai.requestsPerMinute'] = 2;
		await ai.generate(ctx(), base);
		await ai.generate(ctx(), base);
		await expect(ai.generate(ctx(), base)).rejects.toMatchObject({ code: 'rate_limited' });
		resetAllForTests();
		settingsStore['core.ai.monthlyTokenLimit'] = 1000;
		monthTotals = { tokens: 1000, costUsd: 0 };
		await expect(ai.generate(ctx(), base)).rejects.toMatchObject({ code: 'rate_limited' });
		settingsStore['core.ai.monthlyTokenLimit'] = 0;
		settingsStore['core.ai.monthlyCostLimitUsd'] = 5;
		monthTotals = { tokens: 0, costUsd: 5.01 };
		await expect(ai.generate(ctx(), base)).rejects.toMatchObject({ code: 'rate_limited' });
	});

	it('gibt strukturierte JSON-Ausgaben validiert zurück und wiederholt einmal', async () => {
		responses = ['kein json', '{"name":"Max","age":30}'];
		const res = await ai.generateJson(ctx(), {
			...base,
			schema: z.object({ name: z.string(), age: z.number() })
		});
		expect(res.data).toEqual({ name: 'Max', age: 30 });
		expect(calls).toHaveLength(2);
		expect(calls[0]!.json).toBe(true);
		expect(res.usage.inputTokens).toBe(200);

		responses = ['{"x":1}', '{"x":2}'];
		await expect(
			ai.generateJson(ctx(), { ...base, schema: z.object({ name: z.string() }) })
		).rejects.toMatchObject({ code: 'bad_request' });
	});

	it('streamt Text und liefert Nutzungsdaten', async () => {
		const gen = ai.stream(ctx(), base);
		let text = '';
		let r = await gen.next();
		while (!r.done) {
			text += r.value;
			r = await gen.next();
		}
		expect(text).toBe('Hallo');
		expect(r.value).toMatchObject({ inputTokens: 10, outputTokens: 2 });
		expect(recorded).toHaveLength(1);
	});

	it('bildet Anbieterfehler auf Core-Fehler ab', async () => {
		failWith = Object.assign(new Error('rl'), { status: 429 });
		await expect(ai.generate(ctx(), base)).rejects.toMatchObject({ code: 'rate_limited' });
		failWith = Object.assign(new Error('sk-test invalid'), { status: 401 });
		const err = await ai.generate(ctx(), base).catch((e: Error) => e);
		expect(err).toMatchObject({ code: 'unavailable' });
		expect((err as Error).message).not.toContain('sk-test');
	});

	it('verarbeitet Storage-Dateien über den berechtigungsprüfenden Storage-Service', async () => {
		download.mockResolvedValueOnce({
			buffer: new TextEncoder().encode('Inhalt'),
			file: { name: 'a.txt', contentType: 'text/plain' }
		});
		await ai.generate(ctx(), { ...base, files: [{ module: 'members', path: 'a.txt' }] });
		expect(download).toHaveBeenCalledWith(expect.anything(), { module: 'members', path: 'a.txt' });
		expect(JSON.stringify(calls[0]!.messages.at(-1)!.content)).toContain('Inhalt');

		download.mockResolvedValueOnce({
			buffer: new Uint8Array(2),
			file: { name: 'a.exe', contentType: 'application/x-msdownload' }
		});
		await expect(
			ai.generate(ctx(), { ...base, files: [{ module: 'members', path: 'a.exe' }] })
		).rejects.toMatchObject({ code: 'bad_request' });
	});
});
