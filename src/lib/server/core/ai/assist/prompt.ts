/**
 * Prompt-Bau der Schreibhilfe (reine Funktionen). Inhalte der Person stehen zwischen `<<<` und `>>>`
 * und gelten als Daten, nicht als Anweisungen (Schutz vor Anweisungen in eingegangenen Mails).
 */
import {
	ASSIST_LIST_TASKS,
	ASSIST_VARIANT_TASKS,
	type AssistAddress,
	type AssistFormat,
	type AssistTask
} from '$lib/sdk/types/assist';
import { getLocale, tl, type Locale } from '$lib/i18n';
import type { ModuleAssistPurpose } from '../../modules/types';

export interface AssistStyle {
	address: AssistAddress;
	tone: string;
	greeting: string;
	notes: string;
	/** Wer schreibt für wen (`core.ai.style.context`); leer = allgemein */
	context?: string;
	/** Name der Organisation (oder des Systems); leer = ohne */
	organization?: string;
}

export interface PromptInput {
	purpose: ModuleAssistPurpose;
	task: AssistTask;
	text: string;
	instruction?: string;
	facts: Record<string, string>;
	document?: string;
	style: AssistStyle;
}

/** Textschlüssel je Aufgabe (`ai.prompt.task.<…>`); übersetzt erst beim Bau des Prompts */
const TASK_KEY: Record<AssistTask, string> = {
	draft: 'draft',
	rewrite: 'rewrite',
	friendly: 'friendly',
	shorter: 'shorter',
	simple: 'simple',
	spelling: 'spelling',
	english: 'english',
	subject: 'subject',
	title: 'title',
	teaser: 'teaser',
	'alt-text': 'altText',
	split: 'split',
	'packing-list': 'packingList',
	summarize: 'summarize',
	continue: 'continue',
	todos: 'todos'
};

const ADDRESS_KEY: Record<AssistAddress, string> = { du: 'du', ihr: 'ihr', Sie: 'sie' };

function formatRule(locale: Locale, format: AssistFormat, tables = false): string {
	const extra = tables ? ', <table>, <thead>, <tbody>, <tr>, <th>, <td>' : '';
	return format === 'rich'
		? tl(locale, 'ai.prompt.formatRich', { extra })
		: tl(locale, 'ai.prompt.formatPlain');
}

/**
 * System-Prompt mit Ton, Regeln und Zweck – in der Sprache der Oberfläche (`locale`, Standard: aktuelle Sprache).
 * Die Schreibregeln für Deutsch (Gendern, Umlaute, Anrede) gelten nur für deutsche Texte.
 */
export function systemPrompt(input: PromptInput, locale: Locale = getLocale()): string {
	const { purpose, task, style } = input;
	const m = (key: string, params?: Record<string, string | number>) =>
		tl(locale, `ai.prompt.${key}`, params);
	const context = style.context?.trim() ?? '';
	const organization = style.organization?.trim() ?? '';
	const intro = context
		? organization
			? m('introContextOrg', { context, organization })
			: m('introContext', { context })
		: organization
			? m('introOrg', { organization })
			: m('intro');
	const lines = [intro];
	if (style.tone.trim()) lines.push(m('tone', { tone: style.tone.trim() }));
	if (locale === 'de') {
		lines.push(m(`address.${ADDRESS_KEY[style.address]}`));
		lines.push(m('genderUmlauts'));
	}
	lines.push(
		m('noFacts'),
		m('noLegal'),
		m('keepPlaceholders', { ex1: '{name}', ex2: '{{aktion}}' }),
		m('dataNotInstructions'),
		m('purpose', { label: purpose.label, description: purpose.description }),
		m('maxLength', { max: String(purpose.maxChars) })
	);
	if (purpose.letter && task !== 'english') {
		lines.push(m('greeting', { greeting: style.greeting }));
	}
	if (purpose.placeholders?.length) {
		lines.push(m('allowedPlaceholders', { list: purpose.placeholders.join(', ') }));
	}
	if (style.notes.trim()) lines.push(m('styleNotes', { notes: style.notes.trim() }));
	lines.push(m('task', { rule: m(`taskRule.${TASK_KEY[task]}`) }));
	if (!ASSIST_VARIANT_TASKS.includes(task) && !ASSIST_LIST_TASKS.includes(task)) {
		lines.push(
			formatRule(
				locale,
				task === 'alt-text' ? 'plain' : purpose.format,
				purpose.richTables === true
			)
		);
		lines.push(m('onlyText'));
	}
	return lines.join('\n');
}

/** Benutzer-Prompt mit Eckdaten, bisherigem Text, Dokument und Wunsch */
export function userPrompt(input: PromptInput, locale: Locale = getLocale()): string {
	const m = (key: string) => tl(locale, `ai.prompt.user.${key}`);
	const parts: string[] = [];
	const facts = Object.entries(input.facts).filter(([, v]) => v.trim());
	if (facts.length) {
		parts.push(`${m('facts')}\n${facts.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`);
	}
	if (input.document?.trim()) {
		parts.push(`${m('document')}\n<<<\n${input.document.trim()}\n>>>`);
	}
	parts.push(input.text.trim() ? `${m('text')}\n<<<\n${input.text.trim()}\n>>>` : m('textEmpty'));
	if (input.instruction?.trim())
		parts.push(`${m('instruction')}\n<<<\n${input.instruction.trim()}\n>>>`);
	return parts.join('\n\n');
}
