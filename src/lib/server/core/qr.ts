import QRCode from 'qrcode';
import { errors } from './errors';

/** QR-Code als PNG-`data:`-URL. Hohe Fehlerkorrektur, damit gedruckte Codes robust bleiben. */
export async function qrDataUrl(text: string, opts: { widthPx?: number } = {}): Promise<string> {
	if (!text || text.length > 1000) throw errors.badRequest('Ungültiger QR-Inhalt');
	return QRCode.toDataURL(text, {
		margin: 1,
		width: Math.min(Math.max(opts.widthPx ?? 400, 100), 1200),
		errorCorrectionLevel: 'M'
	});
}
