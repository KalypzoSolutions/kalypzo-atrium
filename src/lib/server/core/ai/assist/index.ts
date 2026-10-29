/**
 * KI-Schreibhilfe: Vorschläge für Textstellen, die Module in `ModuleDefinition.assist` anmelden.
 * Ablauf: Zweck + Recht prüfen → Kontext vom Modul (mit den Rechten der Person) → Kontaktdaten
 * maskieren → Anfrage über `core.ai` → Masken zurück, Format bereinigen, Prüfungen. Gespeichert werden
 * wie überall in `core.ai` nur Zähler; das Audit enthält keinen Text.
 */
import { z } from 'zod';
import type {
	AssistAddress,
	AssistRequest,
	AssistResult,
	AssistStatus,
	RequestContext
} from '$lib/sdk/types';
import { ASSIST_LIST_TASKS, ASSIST_VARIANT_TASKS } from '$lib/sdk/types/assist';
import { auditFromContext } from '../../audit/service';
import { logError } from '../../db-errors';
import { errors } from '../../errors';
import { allDefinitions, getDefinition } from '../../modules/registry';
import { enabledModuleIds } from '../../modules/state';
import type { ModuleAssistContext, ModuleAssistPurpose } from '../../modules/types';
import { getSettings } from '../../settings/service';
import {
	actorTokensThisMonth,
	aiAvailability,
	assertAiAccess,
	canUseAi,
	generateJson,
	stream
} from '../index';
import { systemPrompt, userPrompt, type AssistStyle } from './prompt';
import { createRedactor } from './redact';
import { clampPlain, normalizeOutput, verifyOutput } from './verify';

const MAX_EXTRA_CHARS = 2000;
const MAX_DOCUMENT_CHARS = 8000;
const MAX_FACT_CHARS = 1500;

interface AssistSettings {
	style: AssistStyle;
	allowInbox: boolean;
	allowImages: boolean;
	userLimit: number;
}

async function loadAssistSettings(): Promise<AssistSettings> {
	const s = await getSettings([
		'core.ai.style.address',
		'core.ai.style.tone',
		'core.ai.style.greeting',
		'core.ai.style.notes',
		'core.ai.assist.allowInbox',
		'core.ai.assist.allowImages',
		'core.ai.userMonthlyTokenLimit'
	]);
	const address = String(s['core.ai.style.address'] ?? 'du');
	return {
		style: {
			address: (['du', 'ihr', 'Sie'].includes(address) ? address : 'du') as AssistAddress,
			tone: String(s['core.ai.style.tone'] ?? ''),
			greeting: String(s['core.ai.style.greeting'] ?? 'Gut Pfad!'),
			notes: String(s['core.ai.style.notes'] ?? '')
		},
		allowInbox: s['core.ai.assist.allowInbox'] === true,
		allowImages: s['core.ai.assist.allowImages'] === true,
		userLimit: Number(s['core.ai.userMonthlyTokenLimit'] ?? 0)
	};
}

/** Zweck eines aktiven Moduls oder 404 */
async function resolvePurpose(module: string, purpose: string): Promise<ModuleAssistPurpose> {
	const enabled = await enabledModuleIds();
	const def = enabled.has(module) ? getDefinition(module) : undefined;
	const found = def?.assist?.purposes?.[purpose];
	if (!found) throw errors.notFound('Diese Textstelle kennt die Schreibhilfe nicht');
	return found;
}

async function resolveContext(
	ctx: RequestContext,
	purpose: ModuleAssistPurpose,
	ref: NonNullable<AssistRequest['context']>
): Promise<ModuleAssistContext> {
	const key = `${ref.module}:${ref.kind}`;
	if (!purpose.contexts?.includes(key)) {
		throw errors.badRequest('Dieser Kontext ist für die Textstelle nicht vorgesehen');
	}
	const enabled = await enabledModuleIds();
	const provider = enabled.has(ref.module)
		? getDefinition(ref.module)?.assist?.contexts?.[ref.kind]
		: undefined;
	if (!provider) throw errors.notFound();
	const out = await provider(ctx, ref.id);
	if (!out) throw errors.notFound();
	return out;
}

function trimFacts(facts: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(facts)) {
		const value = String(v ?? '').trim();
		if (value) out[k.slice(0, 60)] = value.slice(0, MAX_FACT_CHARS);
	}
	return out;
}

/** Status für die Oberfläche: in welchen Modulen die Person den Knopf sieht */
export async function assistStatus(ctx: RequestContext): Promise<AssistStatus> {
	const enabled = await enabledModuleIds();
	const candidates = allDefinitions()
		.filter((d) => d.assist?.purposes && Object.keys(d.assist.purposes).length > 0)
		.map((d) => d.manifest.id)
		.filter((id) => enabled.has(id) && canUseAi(ctx, id));
	const [availability, settings] = await Promise.all([
		aiAvailability(candidates),
		loadAssistSettings()
	]);
	const purposes: AssistStatus['purposes'] = {};
	for (const id of availability.modules) {
		for (const [key, p] of Object.entries(getDefinition(id)?.assist?.purposes ?? {})) {
			purposes[`${id}:${key}`] = {
				label: p.label,
				format: p.format,
				tasks: p.tasks,
				maxChars: p.maxChars,
				letter: p.letter === true
			};
		}
	}
	return {
		configured: availability.configured,
		modules: availability.modules,
		purposes,
		allowInbox: settings.allowInbox,
		allowImages: settings.allowImages,
		address: settings.style.address
	};
}

const variantsSchema = z.object({ variants: z.array(z.string().min(1).max(400)).min(1).max(5) });
const itemsSchema = z.object({ items: z.array(z.string().min(1).max(200)).min(1).max(40) });

/**
 * Erzeugt einen Vorschlag. `onDelta` bekommt bei Fließtext die Teilstücke (maskiert, nur zur
 * Live-Anzeige); maßgeblich ist das Ergebnis.
 */
export async function runAssist(
	ctx: RequestContext,
	req: AssistRequest,
	onDelta?: (text: string) => void
): Promise<AssistResult> {
	const run = await prepareAssist(ctx, req);
	return run(onDelta);
}

/**
 * Alle Prüfungen und der Kontext (wirft 4xx/503 sofort); Rückgabe = die eigentliche Erzeugung. So
 * liefert der Endpunkt Fehler als normale HTTP-Antwort und öffnet den Strom erst danach.
 */
export async function prepareAssist(
	ctx: RequestContext,
	req: AssistRequest
): Promise<(onDelta?: (text: string) => void, signal?: AbortSignal) => Promise<AssistResult>> {
	const purpose = await resolvePurpose(req.module, req.purpose);
	if (!purpose.tasks.includes(req.task)) {
		throw errors.badRequest('Diese Aktion ist für die Textstelle nicht vorgesehen');
	}
	if (req.task === 'rewrite' && !req.instruction?.trim()) {
		throw errors.validation(
			{ instruction: 'Bitte beschreibe, was geändert werden soll' },
			'Bitte beschreibe, was geändert werden soll'
		);
	}
	await assertAiAccess(ctx, req.module);
	const settings = await loadAssistSettings();
	if (settings.userLimit > 0 && ctx.userId) {
		const used = await actorTokensThisMonth(ctx.userId);
		if (used >= settings.userLimit) {
			throw errors.rateLimited(
				'Dein monatliches Kontingent für die Schreibhilfe ist aufgebraucht. Die Verwaltung kann es erhöhen.'
			);
		}
	}

	const context = req.context ? await resolveContext(ctx, purpose, req.context) : undefined;
	// Heikle Inhalte nur mit Einstellung; sonst ohne sie weiter (Bildbeschreibung braucht das Bild)
	if (context?.document && !settings.allowInbox) delete context.document;
	if (context?.images?.length && !settings.allowImages) {
		if (req.task === 'alt-text') {
			throw errors.forbidden('Bilder dürfen laut Einstellungen nicht an die KI übermittelt werden');
		}
		delete context.images;
	}
	if (req.task === 'alt-text' && !context?.images?.length) {
		throw errors.badRequest('Für eine Bildbeschreibung fehlt das Bild');
	}

	const extra: Record<string, string> = {};
	for (const [key, label] of Object.entries(purpose.extraKeys ?? {})) {
		const v = req.extra?.[key];
		if (typeof v === 'string' && v.trim()) extra[label] = v.trim().slice(0, MAX_EXTRA_CHARS);
	}
	// gespeicherte Eckdaten gewinnen nicht über die ungespeicherten Formularwerte
	const facts = trimFacts({ ...(context?.facts ?? {}), ...extra });
	const document = context?.document?.slice(0, MAX_DOCUMENT_CHARS);

	const redactor = createRedactor();
	const masked = {
		text: redactor.mask(req.text),
		instruction: req.instruction ? redactor.mask(req.instruction) : undefined,
		document: document ? redactor.mask(document) : undefined,
		facts: Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, redactor.mask(v)]))
	};
	const promptInput = {
		purpose,
		task: req.task,
		text: masked.text,
		instruction: masked.instruction,
		facts: masked.facts,
		document: masked.document,
		style: { ...settings.style, address: req.address ?? settings.style.address }
	};
	const base = {
		module: req.module,
		system: systemPrompt(promptInput),
		prompt: userPrompt(promptInput),
		temperature: req.task === 'spelling' ? 0.1 : 0.6,
		images: context?.images
	};
	const sources = [req.text, req.instruction ?? '', document ?? '', ...Object.values(facts)].join(
		'\n'
	);

	return async (onDelta, signal) => {
		let result: AssistResult;
		if (ASSIST_VARIANT_TASKS.includes(req.task) || ASSIST_LIST_TASKS.includes(req.task)) {
			const isList = ASSIST_LIST_TASKS.includes(req.task);
			const res = isList
				? await generateJson(ctx, { ...base, schema: itemsSchema })
				: await generateJson(ctx, { ...base, schema: variantsSchema });
			const raw = 'items' in res.data ? res.data.items : res.data.variants;
			const values = raw
				.map((v) => clampPlain(normalizeOutput(redactor.restore(v), 'plain'), purpose.maxChars))
				.filter(Boolean);
			result = {
				text: '',
				...(isList ? { items: values } : { variants: values }),
				checks: verifyOutput({
					original: req.text,
					output: values.join('\n'),
					sources,
					allowedPlaceholders: purpose.placeholders,
					maxChars: Number.MAX_SAFE_INTEGER
				}).filter((c) => c.level === 'warning'),
				facts,
				tokens: res.usage.inputTokens + res.usage.outputTokens
			};
		} else {
			const gen = stream(ctx, { ...base, maxOutputTokens: 4000, signal });
			let raw = '';
			let next = await gen.next();
			while (!next.done) {
				raw += next.value;
				onDelta?.(next.value);
				next = await gen.next();
			}
			const usage = next.value;
			if (signal?.aborted) throw errors.badRequest('Die Schreibhilfe wurde abgebrochen');
			const format = req.task === 'alt-text' ? 'plain' : purpose.format;
			let text = normalizeOutput(redactor.restore(raw), format, purpose.richTables === true);
			if (format === 'plain') text = clampPlain(text, purpose.maxChars);
			if (!text)
				throw errors.unavailable('Die KI hat keinen Text geliefert. Bitte erneut versuchen.');
			result = {
				text,
				checks: verifyOutput({
					original: req.text,
					output: text,
					sources,
					allowedPlaceholders: purpose.placeholders,
					maxChars: purpose.maxChars
				}),
				facts,
				tokens: usage.inputTokens + usage.outputTokens
			};
		}

		try {
			await auditFromContext(ctx, 'core.ai.assist_used', {
				metadata: {
					module: req.module,
					purpose: req.purpose,
					task: req.task,
					context: req.context ? `${req.context.module}:${req.context.kind}` : null,
					masked: redactor.count,
					tokens: result.tokens
				}
			});
		} catch (e) {
			logError('[best-effort] core.ai.assist-audit fehlgeschlagen', e, {
				requestId: ctx.requestId
			});
		}
		return result;
	};
}
