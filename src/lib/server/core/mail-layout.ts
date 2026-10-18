import lilieUrl from './mail-assets/lilie.png?inline';
import wappenUrl from './mail-assets/wappen.png?inline';
import { escapeHtml } from './pdf/templates';
import { DEFAULT_MAIL_FOOTER } from './settings/catalog';
import { getSettings } from './settings/service';

/**
 * Einheitliches E-Mail-Layout (Kopf mit Lilie, Vereinsname und Wappen, Inhalt, Signatur, Fußzeile),
 * abgeleitet vom Stamm-Briefkopf der PDF-Vorlagen. Wird vom Core für jede ausgehende Mail angewendet
 * und über die Einstellungen `core.mail.*` und `core.design.accentColor` verwaltet.
 * Bilder werden als CID-Anhänge eingebettet (data:-URLs blocken viele Mailprogramme).
 */

export const ORGANIZATION_TITLE = 'Christliche Pfadfinderschaft Deutschlands e.V.';

export const MAIL_SETTING_KEYS = [
	'core.mail.layoutEnabled',
	'core.mail.showEmblem',
	'core.mail.signature',
	'core.mail.footerText',
	'core.design.accentColor',
	'core.system.name'
] as const;

export interface MailLayoutOptions {
	enabled: boolean;
	showEmblem: boolean;
	signature: string;
	footerText: string;
	accentColor: string;
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

const CID = { lilie: 'stamm-lilie@ep-intern', wappen: 'stamm-wappen@ep-intern' } as const;

function dataUrlToBuffer(url: string): Buffer {
	return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

export function mailLayoutOptions(s: Record<string, unknown>): MailLayoutOptions {
	const color = String(s['core.design.accentColor'] ?? '');
	return {
		enabled: s['core.mail.layoutEnabled'] !== false,
		showEmblem: s['core.mail.showEmblem'] !== false,
		signature: String(s['core.mail.signature'] ?? ''),
		footerText: String(s['core.mail.footerText'] ?? DEFAULT_MAIL_FOOTER),
		accentColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#2563eb'
	};
}

export async function loadMailLayoutOptions(): Promise<MailLayoutOptions> {
	return mailLayoutOptions(await getSettings([...MAIL_SETTING_KEYS]));
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
	const lilieSrc = images === 'cid' ? `cid:${CID.lilie}` : lilieUrl;
	const wappenSrc = images === 'cid' ? `cid:${CID.wappen}` : wappenUrl;
	const body = input.html ?? textToHtml(input.text, o.accentColor);
	const signature = o.signature.trim();
	const footer = o.footerText.trim();

	const signatureHtml = signature
		? `<p style="margin:24px 0 0;">${escapeHtml(signature).replace(/\r?\n/g, '<br/>')}</p>`
		: '';
	const emblem = o.showEmblem
		? `<td align="right" valign="top" style="padding:0 0 0 12px;"><img src="${wappenSrc}" alt="" height="66" style="display:block;height:66px;width:auto;border:0;" /></td>`
		: '';
	const footerHtml = footer
		? `<tr><td style="padding:16px 32px 24px;font-size:11px;line-height:15px;color:#6b7280;text-align:center;border-top:1px solid #e5e7eb;">${escapeHtml(footer)}</td></tr>`
		: '';

	const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;border-top:4px solid ${o.accentColor};font-family:${FONT};color:#111827;">
<tr><td style="padding:24px 32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle" width="40" style="width:40px;padding:0 12px 0 0;"><img src="${lilieSrc}" alt="" height="48" style="display:block;height:48px;width:auto;border:0;" /></td>
<td valign="middle" style="font-size:17px;line-height:22px;font-weight:bold;color:#000000;">Christliche<br/>Pfadfinderschaft<br/>Deutschlands e.V.</td>
${emblem}
</tr></table></td></tr>
<tr><td style="padding:8px 32px 24px;font-size:15px;line-height:23px;">${body}${signatureHtml}</td></tr>
${footerHtml}
</table>
</td></tr></table>
</body></html>`;

	const textParts = [input.text.trim()];
	if (signature) textParts.push(signature);
	if (footer) textParts.push(`--\n${ORGANIZATION_TITLE}\n${footer}`);

	const attachments: MailAttachment[] =
		images === 'cid'
			? [
					{
						filename: 'lilie.png',
						content: dataUrlToBuffer(lilieUrl),
						cid: CID.lilie,
						contentType: 'image/png'
					},
					...(o.showEmblem
						? [
								{
									filename: 'wappen.png',
									content: dataUrlToBuffer(wappenUrl),
									cid: CID.wappen,
									contentType: 'image/png'
								}
							]
						: [])
				]
			: [];

	return { text: textParts.join('\n\n'), html, attachments };
}

/** Beispielinhalt für die Admin-Vorschau. */
export const SAMPLE_MAIL_TEXT =
	'Hallo Max Mustermann,\n\nvielen Dank für deine Anmeldung zum Sommerlager. Alle Informationen findest du unter https://intern.example.org/p/actions/anmeldung/beispiel.\n\nBei Fragen antworte einfach auf diese E-Mail.';
