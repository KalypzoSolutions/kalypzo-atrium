import OpenAI from 'openai';
import type {
	ChatCompletionContentPart,
	ChatCompletionMessageParam
} from 'openai/resources/chat/completions';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AiGenerateInput, AiGenerateResult, AiUsage, RequestContext } from '$lib/sdk/types';
import { getDb, schema } from '../database/client';
import { errors, isCoreError } from '../errors';
import { has } from '../permissions/service';
import { hit } from '../rate-limit';
import { getSettings } from '../settings/service';
import { download } from '../storage';
import { newId } from '../util';

// ---------------------------------------------------------------------------
// Abstraktionen (austauschbar für Tests)
// ---------------------------------------------------------------------------

export interface AiChatParams {
	model: string;
	messages: ChatCompletionMessageParam[];
	temperature?: number;
	maxOutputTokens?: number;
	json?: boolean;
	/** Abbruch (z. B. Verbindung geschlossen): bricht die Anfrage beim Anbieter ab */
	signal?: AbortSignal;
}

export interface AiCompletion {
	text: string;
	inputTokens: number;
	outputTokens: number;
}

export interface AiStreamChunk {
	delta?: string;
	usage?: { inputTokens: number; outputTokens: number };
}

export interface AiClient {
	complete(params: AiChatParams): Promise<AiCompletion>;
	stream(params: AiChatParams): AsyncIterable<AiStreamChunk>;
}

export type AiClientFactory = (config: { apiKey: string; baseUrl: string }) => AiClient;

function openAiClient({ apiKey, baseUrl }: { apiKey: string; baseUrl: string }): AiClient {
	const client = new OpenAI({
		apiKey,
		baseURL: baseUrl || undefined,
		maxRetries: 1,
		timeout: 120_000
	});
	const base = (p: AiChatParams) => ({
		model: p.model,
		messages: p.messages,
		temperature: p.temperature,
		max_completion_tokens: p.maxOutputTokens,
		...(p.json && { response_format: { type: 'json_object' as const } })
	});
	return {
		async complete(p) {
			const res = await client.chat.completions.create(base(p));
			return {
				text: res.choices[0]?.message?.content ?? '',
				inputTokens: res.usage?.prompt_tokens ?? 0,
				outputTokens: res.usage?.completion_tokens ?? 0
			};
		},
		async *stream(p) {
			const stream = await client.chat.completions.create(
				{
					...base(p),
					stream: true,
					stream_options: { include_usage: true }
				},
				{ signal: p.signal }
			);
			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta?.content;
				if (delta) yield { delta };
				if (chunk.usage) {
					yield {
						usage: {
							inputTokens: chunk.usage.prompt_tokens,
							outputTokens: chunk.usage.completion_tokens
						}
					};
				}
			}
		}
	};
}

let clientFactory: AiClientFactory = openAiClient;

export function setOpenAiClientFactoryForTests(f: AiClientFactory | undefined): void {
	clientFactory = f ?? openAiClient;
}

export interface UsageRow {
	id: string;
	moduleId: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	actorId: string | null;
}

export interface UsageRepo {
	record(row: UsageRow): Promise<void>;
	/** Summe seit `since` für ein Modul */
	totals(moduleId: string, since: Date): Promise<{ tokens: number; costUsd: number }>;
	/** Token-Summe seit `since` für eine Person (alle Module) */
	totalsForActor(actorId: string, since: Date): Promise<number>;
	summary(from: Date, to: Date): Promise<UsageSummaryRow[]>;
}

export interface UsageSummaryRow {
	moduleId: string;
	model: string;
	requests: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

function dbUsageRepo(): UsageRepo {
	const t = schema.aiUsage;
	return {
		async record(row) {
			await getDb()
				.insert(t)
				.values({ ...row, costUsd: row.costUsd.toFixed(6) });
		},
		async totals(moduleId, since) {
			const [r] = await getDb()
				.select({
					tokens: sql<number>`coalesce(sum(${t.inputTokens} + ${t.outputTokens}), 0)::bigint`,
					cost: sql<string>`coalesce(sum(${t.costUsd}), 0)`
				})
				.from(t)
				.where(and(eq(t.moduleId, moduleId), gte(t.createdAt, since)));
			return { tokens: Number(r?.tokens ?? 0), costUsd: Number(r?.cost ?? 0) };
		},
		async totalsForActor(actorId, since) {
			const [r] = await getDb()
				.select({
					tokens: sql<number>`coalesce(sum(${t.inputTokens} + ${t.outputTokens}), 0)::bigint`
				})
				.from(t)
				.where(and(eq(t.actorId, actorId), gte(t.createdAt, since)));
			return Number(r?.tokens ?? 0);
		},
		async summary(from, to) {
			const rows = await getDb()
				.select({
					moduleId: t.moduleId,
					model: t.model,
					requests: sql<number>`count(*)::int`,
					inputTokens: sql<number>`coalesce(sum(${t.inputTokens}), 0)::bigint`,
					outputTokens: sql<number>`coalesce(sum(${t.outputTokens}), 0)::bigint`,
					cost: sql<string>`coalesce(sum(${t.costUsd}), 0)`
				})
				.from(t)
				.where(and(gte(t.createdAt, from), lte(t.createdAt, to)))
				.groupBy(t.moduleId, t.model);
			return rows.map((r) => ({
				moduleId: r.moduleId,
				model: r.model,
				requests: Number(r.requests),
				inputTokens: Number(r.inputTokens),
				outputTokens: Number(r.outputTokens),
				costUsd: Number(r.cost)
			}));
		}
	};
}

let usageRepo: UsageRepo | undefined;
const usage = (): UsageRepo => (usageRepo ??= dbUsageRepo());

export function setUsageRepoForTests(r: UsageRepo | undefined): void {
	usageRepo = r;
}

// ---------------------------------------------------------------------------
// Konfiguration und Prüfungen
// ---------------------------------------------------------------------------

const MODULE_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
const MAX_TEXT_FILE_CHARS = 200_000;
const MAX_PROMPT_CHARS = 400_000;

interface AiConfig {
	apiKey: string;
	baseUrl: string;
	defaultModel: string;
	allowedModels: string[];
	allowedModules: string[];
	monthlyTokenLimit: number;
	monthlyCostLimitUsd: number;
	requestsPerMinute: number;
	pricing: Record<string, { input: number; output: number }>;
}

async function loadConfig(): Promise<AiConfig> {
	const s = await getSettings([
		'core.ai.apiKey',
		'core.ai.baseUrl',
		'core.ai.defaultModel',
		'core.ai.allowedModels',
		'core.ai.allowedModules',
		'core.ai.monthlyTokenLimit',
		'core.ai.monthlyCostLimitUsd',
		'core.ai.requestsPerMinute',
		'core.ai.pricing'
	]);
	return {
		apiKey: String(s['core.ai.apiKey'] ?? ''),
		baseUrl: String(s['core.ai.baseUrl'] ?? ''),
		defaultModel: String(s['core.ai.defaultModel'] ?? 'gpt-4o-mini'),
		allowedModels: (s['core.ai.allowedModels'] as string[] | undefined) ?? [],
		allowedModules: (s['core.ai.allowedModules'] as string[] | undefined) ?? [],
		monthlyTokenLimit: Number(s['core.ai.monthlyTokenLimit'] ?? 0),
		monthlyCostLimitUsd: Number(s['core.ai.monthlyCostLimitUsd'] ?? 0),
		requestsPerMinute: Number(s['core.ai.requestsPerMinute'] ?? 60),
		pricing: (s['core.ai.pricing'] as AiConfig['pricing'] | undefined) ?? {}
	};
}

function monthStart(now = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function estimateCost(
	pricing: AiConfig['pricing'],
	model: string,
	inputTokens: number,
	outputTokens: number
): number {
	const p = pricing[model];
	if (!p) return 0;
	return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

interface Prepared {
	config: AiConfig;
	model: string;
	client: AiClient;
}

/** Darf `ctx` den KI-Dienst für `module` nutzen? (Recht `<modul>.ai.use` oder `core.ai.manage`) */
export function canUseAi(ctx: RequestContext, module: string): boolean {
	if (ctx.actor.type === 'system') return true;
	if (!ctx.userId) return false;
	return has(ctx, `${module}.ai.use`) || has(ctx, 'core.ai.manage');
}

/** Prüft Recht, Konfiguration und Modul-Freigabe (403/503) – ohne Anfrage an den Anbieter. */
export async function assertAiAccess(ctx: RequestContext, module: string): Promise<void> {
	if (ctx.actor.type !== 'system' && !ctx.userId) throw errors.unauthenticated();
	if (!MODULE_PATTERN.test(module) && module !== 'core') {
		throw errors.badRequest('Ungültige Modul-ID');
	}
	if (!canUseAi(ctx, module)) throw errors.forbidden(`Berechtigung fehlt: ${module}.ai.use`);
	const config = await loadConfig();
	if (!config.apiKey) throw errors.unavailable('KI-Dienst ist nicht konfiguriert');
	if (config.allowedModules.length && !config.allowedModules.includes(module)) {
		throw errors.forbidden(`Modul "${module}" hat keinen Zugriff auf den KI-Dienst`);
	}
}

/** Ist ein KI-Dienst eingerichtet, und für welche der angegebenen Module ist er freigegeben? */
export async function aiAvailability(
	modules: string[]
): Promise<{ configured: boolean; modules: string[] }> {
	const config = await loadConfig();
	if (!config.apiKey) return { configured: false, modules: [] };
	return {
		configured: true,
		modules: config.allowedModules.length
			? modules.filter((m) => config.allowedModules.includes(m))
			: modules
	};
}

/** Verbrauchte Tokens einer Person im laufenden Monat */
export function actorTokensThisMonth(actorId: string): Promise<number> {
	return usage().totalsForActor(actorId, monthStart());
}

async function prepare(ctx: RequestContext, input: AiGenerateInput): Promise<Prepared> {
	if (ctx.actor.type !== 'system' && !ctx.userId) throw errors.unauthenticated();
	if (!MODULE_PATTERN.test(input.module) && input.module !== 'core') {
		throw errors.badRequest('Ungültige Modul-ID');
	}
	if (!canUseAi(ctx, input.module)) {
		throw errors.forbidden(`Berechtigung fehlt: ${input.module}.ai.use`);
	}
	if (input.prompt.length + (input.system?.length ?? 0) > MAX_PROMPT_CHARS) {
		throw errors.tooLarge('Prompt ist zu lang');
	}
	const config = await loadConfig();
	if (!config.apiKey) throw errors.unavailable('KI-Dienst ist nicht konfiguriert');
	if (config.allowedModules.length && !config.allowedModules.includes(input.module)) {
		throw errors.forbidden(`Modul "${input.module}" hat keinen Zugriff auf den KI-Dienst`);
	}
	const model =
		!input.model || input.model === 'configured-default' ? config.defaultModel : input.model;
	if (config.allowedModels.length && !config.allowedModels.includes(model)) {
		throw errors.badRequest(`Modell nicht erlaubt: ${model}`);
	}
	const rate = hit('ai:global', config.requestsPerMinute, 60);
	if (!rate.allowed) {
		throw errors.rateLimited(
			`KI-Anfragelimit erreicht. Erneut versuchen in ${rate.retryAfterSec} s`
		);
	}
	if (config.monthlyTokenLimit > 0 || config.monthlyCostLimitUsd > 0) {
		const totals = await usage().totals(input.module, monthStart());
		if (config.monthlyTokenLimit > 0 && totals.tokens >= config.monthlyTokenLimit) {
			throw errors.rateLimited(`Monatliches Token-Limit für Modul "${input.module}" erreicht`);
		}
		if (config.monthlyCostLimitUsd > 0 && totals.costUsd >= config.monthlyCostLimitUsd) {
			throw errors.rateLimited(`Monatliches Kostenlimit für Modul "${input.module}" erreicht`);
		}
	}
	return {
		config,
		model,
		client: clientFactory({ apiKey: config.apiKey, baseUrl: config.baseUrl })
	};
}

async function buildMessages(
	ctx: RequestContext,
	input: AiGenerateInput,
	extraSystem?: string
): Promise<ChatCompletionMessageParam[]> {
	const parts: ChatCompletionContentPart[] = [{ type: 'text', text: input.prompt }];
	for (const img of input.images ?? []) {
		if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(img) && !/^https:\/\//.test(img)) {
			throw errors.badRequest('Bilder müssen als Data-URL oder https-URL übergeben werden');
		}
		parts.push({ type: 'image_url', image_url: { url: img } });
	}
	for (const f of input.files ?? []) {
		const { buffer, file } = await download(ctx, f);
		const ct = file.contentType;
		if (ct.startsWith('image/')) {
			const b64 = Buffer.from(buffer).toString('base64');
			parts.push({ type: 'image_url', image_url: { url: `data:${ct};base64,${b64}` } });
		} else if (ct.startsWith('text/') || ct === 'application/json') {
			const text = Buffer.from(buffer).toString('utf8').slice(0, MAX_TEXT_FILE_CHARS);
			parts.push({ type: 'text', text: `--- Datei: ${file.name} ---\n${text}` });
		} else if (ct === 'application/pdf') {
			parts.push({
				type: 'file',
				file: {
					filename: file.name,
					file_data: `data:application/pdf;base64,${Buffer.from(buffer).toString('base64')}`
				}
			});
		} else {
			throw errors.badRequest(`Dateityp wird vom KI-Dienst nicht unterstützt: ${ct}`);
		}
	}
	const system = [input.system, extraSystem].filter(Boolean).join('\n\n');
	return [
		...(system ? [{ role: 'system' as const, content: system }] : []),
		{ role: 'user' as const, content: parts.length === 1 ? input.prompt : parts }
	];
}

function mapError(e: unknown): never {
	if (isCoreError(e)) throw e;
	const status = (e as { status?: number }).status;
	if (status === 429) throw errors.rateLimited('Das KI-Anbieterlimit wurde erreicht');
	if (status === 401 || status === 403)
		throw errors.unavailable('KI-Zugangsdaten wurden abgelehnt');
	if (status === 400 || status === 404 || status === 422) {
		throw errors.badRequest(
			'Die KI-Anfrage wurde vom Anbieter abgelehnt (Modell oder Eingabe prüfen)'
		);
	}
	throw errors.unavailable('KI-Dienst ist nicht erreichbar');
}

async function account(
	ctx: RequestContext,
	p: Prepared,
	module: string,
	inputTokens: number,
	outputTokens: number
): Promise<AiUsage> {
	const costUsd = estimateCost(p.config.pricing, p.model, inputTokens, outputTokens);
	// Es werden ausschließlich Zähler gespeichert, keine Prompts oder Antworten
	await usage().record({
		id: newId(),
		moduleId: module,
		model: p.model,
		inputTokens,
		outputTokens,
		costUsd,
		actorId: ctx.userId
	});
	return { model: p.model, inputTokens, outputTokens, estimatedCostUsd: costUsd };
}

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

export interface GenerateOptions {
	json?: boolean;
	extraSystem?: string;
}

export async function generate(
	ctx: RequestContext,
	input: AiGenerateInput,
	opts: GenerateOptions = {}
): Promise<AiGenerateResult> {
	const p = await prepare(ctx, input);
	const messages = await buildMessages(ctx, input, opts.extraSystem);
	let res: AiCompletion;
	try {
		res = await p.client.complete({
			model: p.model,
			messages,
			temperature: input.temperature,
			maxOutputTokens: input.maxOutputTokens,
			json: opts.json
		});
	} catch (e) {
		mapError(e);
	}
	const u = await account(ctx, p, input.module, res.inputTokens, res.outputTokens);
	return { text: res.text, usage: u };
}

export async function generateJson<T>(
	ctx: RequestContext,
	input: AiGenerateInput & { schema: z.ZodType<T> }
): Promise<{ data: T; usage: AiUsage }> {
	const { schema: zodSchema, ...base } = input;
	const jsonSchema = JSON.stringify(z.toJSONSchema(zodSchema));
	const extraSystem = `Antworte ausschließlich mit einem gültigen JSON-Objekt, das diesem JSON-Schema entspricht:\n${jsonSchema}`;
	let total: AiUsage | undefined;
	for (let attempt = 0; attempt < 2; attempt++) {
		const res = await generate(ctx, base, { json: true, extraSystem });
		total = total
			? {
					...res.usage,
					inputTokens: total.inputTokens + res.usage.inputTokens,
					outputTokens: total.outputTokens + res.usage.outputTokens,
					estimatedCostUsd: total.estimatedCostUsd + res.usage.estimatedCostUsd
				}
			: res.usage;
		try {
			const parsed = zodSchema.safeParse(JSON.parse(res.text));
			if (parsed.success) return { data: parsed.data, usage: total };
		} catch {
			// ungültiges JSON: ein weiterer Versuch
		}
	}
	throw errors.badRequest('Die KI-Antwort entsprach nicht dem erwarteten Format');
}

/** Streamt Textfragmente; der Rückgabewert des Generators sind die Nutzungsdaten. */
export async function* stream(
	ctx: RequestContext,
	input: AiGenerateInput
): AsyncGenerator<string, AiUsage> {
	const p = await prepare(ctx, input);
	const messages = await buildMessages(ctx, input);
	let inputTokens = 0;
	let outputTokens = 0;
	let streamed = 0;
	try {
		for await (const chunk of p.client.stream({
			model: p.model,
			messages,
			temperature: input.temperature,
			maxOutputTokens: input.maxOutputTokens,
			signal: input.signal
		})) {
			if (input.signal?.aborted) break;
			if (chunk.delta) {
				streamed += chunk.delta.length;
				yield chunk.delta;
			}
			if (chunk.usage) {
				inputTokens = chunk.usage.inputTokens;
				outputTokens = chunk.usage.outputTokens;
			}
		}
	} catch (e) {
		// abgebrochen: bisher Erzeugtes trotzdem abrechnen (Schätzung unten)
		if (!input.signal?.aborted) mapError(e);
	}
	// Anbieter ohne Usage-Angabe: grobe Schätzung (~4 Zeichen je Token)
	if (!inputTokens && !outputTokens && streamed) {
		inputTokens = Math.ceil(input.prompt.length / 4);
		outputTokens = Math.ceil(streamed / 4);
	}
	return account(ctx, p, input.module, inputTokens, outputTokens);
}

export async function usageSummary(
	ctx: RequestContext,
	range: { from?: Date; to?: Date } = {}
): Promise<UsageSummaryRow[]> {
	if (ctx.actor.type !== 'system') {
		if (!ctx.userId) throw errors.unauthenticated();
		if (!has(ctx, 'core.ai.view') && !has(ctx, 'core.ai.manage')) {
			throw errors.forbidden('Berechtigung fehlt: core.ai.view');
		}
	}
	return usage().summary(range.from ?? monthStart(), range.to ?? new Date());
}
