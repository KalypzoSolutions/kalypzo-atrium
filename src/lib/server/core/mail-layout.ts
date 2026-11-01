import { getLocale, t } from '$lib/i18n';
import { escapeHtml } from './pdf/templates';
import { activeModuleHook } from './pdf/resolve';
import { DEFAULT_MAIL_FOOTER } from './settings/catalog';
import { getSettings } from './settings/service';

/**
 * Einheitliches E-Mail-Layout (Kopf mit Bildmarke, Name und Emblem, Inhalt, Signatur, Fußzeile). Wird vom Core
 * für jede ausgehende Mail angewendet und über die Einstellungen `core.mail.*` und `core.design.accentColor`
 * verwaltet. Kopf neutral aus dem Logo der Design-Einstellungen und dem Namen der Organisation (sonst
 * Systemname); ein aktives Modul mit `mailBranding` ersetzt ihn (z. B. ein Profil-Modul einer Organisation).
 * Bilder werden als CID-Anhänge eingebettet (data:-URLs blocken viele Mailprogramme).
 */

export const MAIL_SETTING_KEYS = [
	'core.mail.layoutEnabled',
	'core.mail.showEmblem',
	'core.mail.signature',
	'core.mail.footerText',
	'core.design.accentColor',
	'core.system.name',
	'core.organization.name'
] as const;

/**
 * Kopf des E-Mail-Layouts aus einem Modul (`ModuleDefinition.mailBranding`, z. B. Profil-Modul einer
 * Organisation). Ohne Modul: Logo aus den Design-Einstellungen + Name der Organisation bzw. des Systems.
 */
export interface MailBranding {
	/** Name im Kopf (Zeilenumbrüche mit `\n`), auch im Fuß der Textfassung */
	title: string;
	/** Bild links neben dem Namen (Data-URL, PNG) */
	mark?: { dataUrl: string; alt: string };
	/** Emblem rechts, nur mit Einstellung `core.mail.showEmblem` (Data-URL, PNG) */
	emblem?: { dataUrl: string; alt: string };
}

export interface MailLayoutOptions {
	enabled: boolean;
	showEmblem: boolean;
	signature: string;
	footerText: string;
	accentColor: string;
	/** Kopf (Name, Bilder); ohne Angabe nur der Name aus den Einstellungen */
	branding?: MailBranding;
}

export interface MailAttachment {
	filename: string;
	content: Buffer;
	cid: string;
	contentType: string;
}

export interface LayoutInput {
	text: string;
	/** HTML-Fragment (Inhalt); ohne Angabe wird es aus `text` erzeugt */
	html?: string;
}

export interface LayoutResult {
	text: string;
	html: string;
	attachments: MailAttachment[];
}

const CID = { mark: 'brand-mark@atrium', emblem: 'brand-emblem@atrium' } as const;

const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,/;

function dataUrlToBuffer(url: string): Buffer {
	return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

function dataUrlType(url: string): string {
	return IMAGE_DATA_URL.exec(url)?.[1] ?? 'image/png';
}

/** Name für den neutralen Kopf: Organisation, sonst Systemname */
function neutralTitle(s: Record<string, unknown>): string {
	const org = String(s['core.organization.name'] ?? '').trim();
	return org || String(s['core.system.name'] ?? '').trim();
}

export function mailLayoutOptions(
	s: Record<string, unknown>,
	branding?: MailBranding
): MailLayoutOptions {
	const color = String(s['core.design.accentColor'] ?? '');
	return {
		enabled: s['core.mail.layoutEnabled'] !== false,
		showEmblem: s['core.mail.showEmblem'] !== false,
		signature: String(s['core.mail.signature'] ?? ''),
		footerText: String(s['core.mail.footerText'] ?? DEFAULT_MAIL_FOOTER),
		accentColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#2563eb',
		branding: branding ?? { title: neutralTitle(s) }
	};
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hochgeladenes Logo (`core.design.logoFileId`) als Data-URL; Fehler oder kein Logo → `null` */
async function uploadedLogo(): Promise<string | null> {
	try {
		const [id] = Object.values(await getSettings(['core.design.logoFileId']));
		if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
		// dynamisch: Storage zieht viele Core-Teile nach (kein Import-Zyklus über `mail.ts`)
		const { readFileByIdUnchecked } = await import('./storage');
		const file = await readFileByIdUnchecked(id, { module: 'core', pathPrefix: 'branding/' });
		if (!file || !/^image\/(png|jpeg|webp)$/.test(file.contentType)) return null;
		return `data:${file.contentType};base64,${Buffer.from(file.buffer).toString('base64')}`;
	} catch {
		return null;
	}
}

/** Kopf: Modul mit `mailBranding` (aktiv) oder neutral aus Logo und Name */
async function resolveBranding(s: Record<string, unknown>): Promise<MailBranding> {
	const fromModule = await activeModuleHook('mailBranding');
	if (fromModule) return fromModule.value;
	const title = neutralTitle(s);
	const logo = await uploadedLogo();
	return logo ? { title, mark: { dataUrl: logo, alt: title || t('mail.logoAlt') } } : { title };
}

export async function loadMailLayoutOptions(): Promise<MailLayoutOptions> {
	const s = await getSettings([...MAIL_SETTING_KEYS]);
	return mailLayoutOptions(s, await resolveBranding(s));
}

/** Text -> HTML: escaped, Absätze, Zeilenumbrüche, http(s)-Links. */
export function textToHtml(text: string, accent: string): string {
	const link = (s: string) =>
		escapeHtml(s).replace(
			/https?:\/\/[^\s<]+/g,
			(u) => `<a href="${u}" style="color:${accent};word-break:break-all;">${u}</a>`
		);
	return text
		.replace(/\r\n?/g, '\n')
		.trim()
		.split(/\n{2,}/)
		.map((p) => `<p style="margin:0 0 16px;">${link(p).replace(/\n/g, '<br/>')}</p>`)
		.join('');
}

const FONT = "Calibri, Carlito, 'Segoe UI', Helvetica, Arial, sans-serif";

/**
 * Baut Text- und HTML-Fassung. `images` bestimmt, wie Bilder eingebunden werden:
 * `cid` (Versand) oder `data` (Admin-Vorschau).
 */
export function renderMailLayout(
	input: LayoutInput,
	o: MailLayoutOptions,
	images: 'cid' | 'data' = 'cid'
): LayoutResult {
	const brand = o.branding ?? { title: '' };
	const mark = brand.mark && IMAGE_DATA_URL.test(brand.mark.dataUrl) ? brand.mark : undefined;
	const emblemImg =
		o.showEmblem && brand.emblem && IMAGE_DATA_URL.test(brand.emblem.dataUrl)
			? brand.emblem
			: undefined;
	const markSrc = mark ? (images === 'cid' ? `cid:${CID.mark}` : mark.dataUrl) : '';
	const emblemSrc = emblemImg ? (images === 'cid' ? `cid:${CID.emblem}` : emblemImg.dataUrl) : '';
	const brandTitle = brand.title.trim();
	const body = input.html ?? textToHtml(input.text, o.accentColor);
	// Erste Zeile des Textes als Titel (Mailclients ohne Betreff-Vorschau, wenig Spam-Punkte für leere Titel)
	const title = input.text.trim().split(/\r?\n/)[0]?.slice(0, 80) ?? '';
	const signature = o.signature.trim();
	const footer = o.footerText.trim();

	const signatureHtml = signature
		? `<p style="margin:24px 0 0;">${escapeHtml(signature).replace(/\r?\n/g, '<br/>')}</p>`
		: '';
	const emblem = emblemImg
		? `<td align="right" valign="top" style="padding:0 0 0 12px;"><img src="${emblemSrc}" alt="${escapeHtml(emblemImg.alt)}" height="66" style="display:block;height:66px;width:auto;border:0;" /></td>`
		: '';
	const markCell = mark
		? `<td valign="middle" width="40" style="width:40px;padding:0 12px 0 0;"><img src="${markSrc}" alt="${escapeHtml(mark.alt)}" height="48" style="display:block;height:48px;width:auto;border:0;" /></td>`
		: '';
	const titleCell = brandTitle
		? `<td valign="middle" style="font-size:17px;line-height:22px;font-weight:bold;color:#000000;">${brandTitle
				.split(/\r?\n/)
				.map((l) => escapeHtml(l.trim()))
				.join('<br/>')}</td>`
		: '';
	const headRow =
		markCell || titleCell || emblem
			? `<tr><td style="padding:24px 32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
${markCell}
${titleCell}
${emblem}
</tr></table></td></tr>`
			: '';
	const footerHtml = footer
		? `<tr><td style="padding:16px 32px 24px;font-size:11px;line-height:15px;color:#6b7280;text-align:center;border-top:1px solid #e5e7eb;">${escapeHtml(footer)}</td></tr>`
		: '';

	const html = `<!DOCTYPE html>
<html lang="${getLocale()}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light"/><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;border-top:4px solid ${o.accentColor};font-family:${FONT};color:#111827;">
${headRow}
<tr><td style="padding:8px 32px 24px;font-size:15px;line-height:23px;">${body}${signatureHtml}</td></tr>
${footerHtml}
</table>
</td></tr></table>
</body></html>`;

	const textParts = [input.text.trim()];
	if (signature) textParts.push(signature);
	const titleLine = brandTitle.replace(/\s*\r?\n\s*/g, ' ');
	if (footer) textParts.push(['--', titleLine, footer].filter(Boolean).join('\n'));

	const attachments: MailAttachment[] = [];
	if (images === 'cid') {
		for (const [img, cid, name] of [
			[mark, CID.mark, 'mark'],
			[emblemImg, CID.emblem, 'emblem']
		] as const) {
			if (!img) continue;
			const type = dataUrlType(img.dataUrl);
			attachments.push({
				filename: `${name}.${type.split('/')[1]}`,
				content: dataUrlToBuffer(img.dataUrl),
				cid,
				contentType: type
			});
		}
	}

	return { text: textParts.join('\n\n'), html, attachments };
}

/** Beispielinhalt für die Admin-Vorschau (in der Sprache der Anzeige). */
export function sampleMailText(): string {
	return t('mail.sample');
}
