/**
 * Einheitliches Lesen von Datei-Uploads (multipart) für Modul-Endpoints (#33).
 *
 *   const file = await readUpload(request, {
 *   	maxBytes: 10 * 1024 * 1024,
 *   	allowedTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
 *   	typesLabel: 'PDF, JPEG, PNG oder WebP'
 *   });
 *   await core.storage.upload(ctx, { module, path: `x/${safeFileName(file.name)}`, file: file.bytes, … });
 *
 * Fehlerregel (überall gleich):
 * - kaputter Body / kein multipart → 400 `bad_request` „Ungültige Formulardaten“
 * - Feld fehlt, Datei leer, Typ nicht erlaubt, Inhalt passt nicht zum Typ (Magic Bytes) → 422 mit Pfad `[field]`
 * - zu groß → 413 `payload_too_large` „Die Datei ist zu groß (höchstens N MB).“
 *
 * Der Typ wird nie nur aus der Client-Angabe übernommen: Mit `sniff` (Standard) muss der Inhalt zum Typ passen
 * (`assertContentMatches`). Mehrfeld-Formulare lesen die Formulardaten selbst (`readFormData`) und prüfen die
 * Datei mit `takeUpload`; schon gelesene Bytes (z. B. aus einem anderen Modul) prüft `checkUploadBytes`.
 */
import { errors } from '$lib/server/core/errors';
import { assertContentMatches, detectContentType } from './file-response';

export interface UploadRules {
	/** Formularfeld (Standard `file`) */
	field?: string;
	/** Höchstgröße in Byte (413 darüber) */
	maxBytes: number;
	/** Erlaubte MIME-Typen (klein geschrieben, ohne Parameter); fehlt = jeder Typ */
	allowedTypes?: readonly string[];
	/** Lesbare Liste für die Fehlermeldung, z. B. „PDF, JPEG, PNG oder WebP“ */
	typesLabel?: string;
	/** Datei Pflicht (Standard `true`); `false` → fehlendes Feld oder leere Datei = `null` */
	required?: boolean;
	/** Inhalt per Magic Bytes gegen den Typ prüfen (Standard `true`) */
	sniff?: boolean;
	/** Fehlt die Client-Angabe des Typs, wird er aus dem Inhalt ermittelt (z. B. Bilder) */
	detectMissingType?: boolean;
	/** Anzeigename, wenn der Client keinen Dateinamen schickt (Standard `datei`) */
	fallbackName?: string;
}

export interface UploadedFile {
	bytes: Uint8Array;
	/** Geprüfter MIME-Typ (klein geschrieben, ohne Parameter) */
	contentType: string;
	/** Anzeigename (getrimmt, **nicht** bereinigt – für Pfade `safeFileName` nutzen) */
	name: string;
	size: number;
}

/** Zuschlag für Multipart-Grenzen und Textfelder bei der Vorprüfung über `content-length` */
const BODY_OVERHEAD = 1024 * 1024;

const baseType = (t: string | null | undefined) => (t ?? '').split(';')[0]!.trim().toLowerCase();

function formatMb(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	return Number.isInteger(mb) ? String(mb) : mb.toFixed(1).replace('.', ',');
}

const fieldError = (field: string, message: string) =>
	errors.validation([{ path: [field], message }]);

/** Formulardaten lesen; kaputter Body → 400 „Ungültige Formulardaten“. */
export async function readFormData(request: Request): Promise<FormData> {
	return request.formData().catch(() => {
		throw errors.badRequest('Ungültige Formulardaten');
	});
}

/** Prüft bereits gelesene Bytes nach den gleichen Regeln wie `readUpload`. */
export function checkUploadBytes(
	input: { bytes: Uint8Array; contentType?: string | null; name?: string | null },
	rules: UploadRules
): UploadedFile {
	const field = rules.field ?? 'file';
	const size = input.bytes.byteLength;
	if (size === 0) throw fieldError(field, 'Die Datei ist leer');
	if (size > rules.maxBytes) {
		throw errors.tooLarge(`Die Datei ist zu groß (höchstens ${formatMb(rules.maxBytes)} MB).`);
	}
	let contentType = baseType(input.contentType);
	if (!contentType && rules.detectMissingType) contentType = detectContentType(input.bytes) ?? '';
	if (rules.allowedTypes && !rules.allowedTypes.includes(contentType)) {
		throw fieldError(
			field,
			rules.typesLabel ? `Dateityp nicht erlaubt (${rules.typesLabel})` : 'Dateityp nicht erlaubt'
		);
	}
	if (rules.sniff !== false) assertContentMatches(input.bytes, contentType, [field]);
	return {
		bytes: input.bytes,
		contentType: contentType || 'application/octet-stream',
		name: input.name?.trim() || rules.fallbackName || 'datei',
		size
	};
}

/** Datei aus schon gelesenen Formulardaten prüfen (Mehrfeld-Formulare). */
export async function takeUpload(
	form: FormData,
	rules: UploadRules & { required: false }
): Promise<UploadedFile | null>;
export async function takeUpload(
	form: FormData,
	rules: UploadRules & { required?: true }
): Promise<UploadedFile>;
export async function takeUpload(form: FormData, rules: UploadRules): Promise<UploadedFile | null>;
export async function takeUpload(form: FormData, rules: UploadRules): Promise<UploadedFile | null> {
	const field = rules.field ?? 'file';
	const required = rules.required !== false;
	const file = form.get(field);
	if (!(file instanceof File) || (!required && file.size === 0)) {
		if (!required) return null;
		throw fieldError(field, 'Bitte eine Datei auswählen');
	}
	if (file.size === 0) throw fieldError(field, 'Die Datei ist leer');
	// Größe vor dem Einlesen der Bytes prüfen
	if (file.size > rules.maxBytes) {
		throw errors.tooLarge(`Die Datei ist zu groß (höchstens ${formatMb(rules.maxBytes)} MB).`);
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	return checkUploadBytes({ bytes, contentType: file.type, name: file.name }, rules);
}

/**
 * Einzeldatei-Upload lesen und prüfen (siehe Dateikommentar). Ein angegebener `content-length` über
 * `maxBytes` + 1 MB wird schon vor dem Einlesen mit 413 abgelehnt.
 */
export async function readUpload(
	request: Request,
	rules: UploadRules & { required: false }
): Promise<UploadedFile | null>;
export async function readUpload(
	request: Request,
	rules: UploadRules & { required?: true }
): Promise<UploadedFile>;
export async function readUpload(
	request: Request,
	rules: UploadRules
): Promise<UploadedFile | null>;
export async function readUpload(
	request: Request,
	rules: UploadRules
): Promise<UploadedFile | null> {
	const length = Number(request.headers.get('content-length') ?? '');
	if (Number.isFinite(length) && length > rules.maxBytes + BODY_OVERHEAD) {
		throw errors.tooLarge(`Die Datei ist zu groß (höchstens ${formatMb(rules.maxBytes)} MB).`);
	}
	return takeUpload(await readFormData(request), rules);
}

// Dateinamen-Bereinigung (rein, auch im Browser nutzbar) – hier für Server-Code weitergereicht
export { safeFileName, type SafeFileNameOptions } from '$lib/sdk/file-names';
