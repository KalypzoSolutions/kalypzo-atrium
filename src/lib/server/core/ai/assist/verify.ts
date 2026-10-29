/**
 * Nachbearbeitung der KI-Antwort: Format bereinigen und prüfen, ob Platzhalter erhalten blieben und
 * keine Zahlen/Daten erfunden wurden. Reine Funktionen (Unit-Tests: `tests/unit/ai-assist.test.ts`).
 */
import sanitizeHtml from 'sanitize-html';
import type { AssistCheck, AssistFormat } from '$lib/sdk/types/assist';
import { RICH_TEXT_TAGS, sanitizeRichText } from '$lib/sdk/server/html';

const PLACEHOLDER_RE = /\{\{\s*[A-Za-zÄÖÜäöüß_][\w-]*\s*\}\}|\{\s*[A-Za-zÄÖÜäöüß_][\w-]*\s*\}/g;

/** Platzhalter wie `{name}` oder `{{aktion}}` in Reihenfolge, ohne Duplikate */
export function placeholdersIn(text: string): string[] {
	return [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[0].replace(/\s+/g, '')))];
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Entfernt Codeblöcke und einleitende Floskeln, die Modelle gern um die Antwort legen */
export function stripWrapper(text: string): string {
	let t = text.trim();
	const fence = /^```[a-z]*\s*\n([\s\S]*?)\n?```$/i.exec(t);
	if (fence) t = fence[1]!.trim();
	return t;
}

/** Markdown-Reste (fett, Listen) in HTML übersetzen, wenn das Modell kein HTML geliefert hat */
function plainToHtml(text: string): string {
	const blocks = text
		.split(/\n{2,}/)
		.map((b) => b.trim())
		.filter(Boolean);
	return blocks
		.map((block) => {
			const lines = block.split('\n');
			if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
				const items = lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`);
				return `<ul>${items.join('')}</ul>`;
			}
			return `<p>${lines.map(inline).join('<br>')}</p>`;
		})
		.join('');
}

function inline(s: string): string {
	return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/** HTML → reiner Text (Absätze als Leerzeilen, Listen mit „- “) */
export function htmlToText(html: string): string {
	const withBreaks = html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<li[^>]*>/gi, '- ')
		.replace(/<\/(p|h2|h3|li|blockquote)>/gi, '\n')
		.replace(/<\/(ul|ol)>/gi, '\n');
	const text = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
	return text
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

const TABLE_TAGS = ['table', 'thead', 'tbody', 'tr', 'th', 'td'];

/** Antwort in das Format des Feldes bringen (`tables` = Tabellen zusätzlich erlauben) */
export function normalizeOutput(raw: string, format: AssistFormat, tables = false): string {
	const text = stripWrapper(raw);
	if (format === 'plain') {
		const plain = /<[a-z][\s\S]*>/i.test(text) ? htmlToText(text) : text;
		return plain.replace(/\*\*(.+?)\*\*/g, '$1').trim();
	}
	const html = /<(p|ul|ol|h2|h3|br|strong|em|table)\b/i.test(text) ? text : plainToHtml(text);
	if (!tables) return sanitizeRichText(html);
	return sanitizeHtml(html, {
		allowedTags: [...RICH_TEXT_TAGS, ...TABLE_TAGS],
		allowedAttributes: { a: ['href'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
		allowedSchemes: ['http', 'https', 'mailto'],
		allowProtocolRelative: false
	}).trim();
}

/** Auf `max` Zeichen kürzen, möglichst an einer Wortgrenze (nur für reinen Text) */
export function clampPlain(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const space = cut.lastIndexOf(' ');
	return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

/** Ganze Zahlen im Text (Datumsteile einzeln), z. B. „13“, „2026“, „65“; führende Nullen entfallen */
function numbersIn(text: string): Set<string> {
	return new Set([...text.matchAll(/\d+/g)].map((m) => String(Number(m[0]))));
}

export interface VerifyInput {
	original: string;
	output: string;
	/** Alles, was die KI als Quelle bekam (Text, Fakten, Wunsch) – für die Zahlenprüfung */
	sources: string;
	allowedPlaceholders?: string[];
	maxChars: number;
}

/** Prüfungen für die Anzeige im Blatt */
export function verifyOutput(input: VerifyInput): AssistCheck[] {
	const checks: AssistCheck[] = [];
	const before = placeholdersIn(input.original);
	const after = placeholdersIn(input.output);
	const missing = before.filter((p) => !after.includes(p));
	const allowed = new Set([...(input.allowedPlaceholders ?? []), ...before]);
	const unknown = after.filter((p) => !allowed.has(p));
	if (missing.length) {
		checks.push({ level: 'warning', message: `Platzhalter fehlt: ${missing.join(', ')}` });
	} else if (before.length) {
		checks.push({ level: 'ok', message: `Platzhalter erhalten: ${before.join(', ')}` });
	}
	if (unknown.length) {
		checks.push({ level: 'warning', message: `Unbekannter Platzhalter: ${unknown.join(', ')}` });
	}
	const known = numbersIn(input.sources);
	const invented = [...numbersIn(htmlToText(input.output))].filter((n) => !known.has(n));
	if (invented.length) {
		checks.push({
			level: 'warning',
			message: `Enthält Zahlen, die nicht vorgegeben waren (${invented.slice(0, 5).join(', ')}) – bitte prüfen`
		});
	} else {
		checks.push({ level: 'ok', message: 'Keine neuen Zahlen oder Daten erfunden' });
	}
	if (input.output.length > input.maxChars) {
		checks.push({
			level: 'warning',
			message: `Länger als erlaubt (${input.output.length} von ${input.maxChars} Zeichen) – bitte kürzen`
		});
	}
	return checks;
}
