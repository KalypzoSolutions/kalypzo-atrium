/**
 * Standard-Allowlist für Datei-Uploads über `core.storage` (gilt, solange `core.storage.allowedContentTypes` leer ist)
 * und Zuordnung Dateiendung → Typ. Rein, für Server und Browser; einzige Quelle für Core und Modul `files`.
 * Makro-Formate (`.docm`, `.xlsm`, `.pptm`, `.dotm` …) sind bewusst nicht enthalten – bei Bedarf in den Einstellungen freigeben.
 */

export const DEFAULT_ALLOWED_CONTENT_TYPES: readonly string[] = [
	'application/pdf',
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'image/avif',
	'text/plain',
	'text/csv',
	'text/markdown',
	'application/json',
	'application/zip',
	// Word (Dokument, Vorlage), RTF
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
	'application/rtf',
	'text/rtf',
	// Excel (Tabelle, Vorlage)
	'application/vnd.ms-excel',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
	// PowerPoint (Präsentation, Vorlage, Bildschirmpräsentation)
	'application/vnd.ms-powerpoint',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	'application/vnd.openxmlformats-officedocument.presentationml.template',
	'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
	// OpenDocument (LibreOffice) inkl. Vorlagen
	'application/vnd.oasis.opendocument.text',
	'application/vnd.oasis.opendocument.text-template',
	'application/vnd.oasis.opendocument.spreadsheet',
	'application/vnd.oasis.opendocument.spreadsheet-template',
	'application/vnd.oasis.opendocument.presentation',
	'application/vnd.oasis.opendocument.presentation-template'
];

/** Typ nach Dateiendung (klein geschrieben, ohne Punkt) – Rückfall, wenn der Browser keinen Typ meldet */
export const EXTENSION_CONTENT_TYPES: Readonly<Record<string, string>> = {
	pdf: 'application/pdf',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	txt: 'text/plain',
	csv: 'text/csv',
	md: 'text/markdown',
	json: 'application/json',
	zip: 'application/zip',
	doc: 'application/msword',
	dot: 'application/msword',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
	rtf: 'application/rtf',
	xls: 'application/vnd.ms-excel',
	xlt: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
	ppt: 'application/vnd.ms-powerpoint',
	pot: 'application/vnd.ms-powerpoint',
	pps: 'application/vnd.ms-powerpoint',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
	ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
	odt: 'application/vnd.oasis.opendocument.text',
	ott: 'application/vnd.oasis.opendocument.text-template',
	ods: 'application/vnd.oasis.opendocument.spreadsheet',
	ots: 'application/vnd.oasis.opendocument.spreadsheet-template',
	odp: 'application/vnd.oasis.opendocument.presentation',
	otp: 'application/vnd.oasis.opendocument.presentation-template'
};
