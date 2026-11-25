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
	// Videos (MP4/M4V, MOV, WebM)
	'video/mp4',
	'video/quicktime',
	'video/webm',
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
	'application/vnd.oasis.opendocument.presentation-template',
	// Archive
	'application/x-7z-compressed',
	'application/vnd.rar',
	'application/x-tar',
	'application/gzip',
	// Adobe (Photoshop, Illustrator, EPS, InDesign, XD, After Effects, Premiere)
	'image/vnd.adobe.photoshop',
	'application/illustrator',
	'application/postscript',
	'application/x-indesign',
	'application/vnd.adobe.indesign-idml-package',
	'application/vnd.adobe.xd',
	'application/vnd.adobe.aftereffects.project',
	'application/vnd.adobe.premiere.project',
	// Affinity (Designer, Photo, Publisher, Affinity 3 „.af“, Vorlagen)
	'application/x-affinity-designer',
	'application/x-affinity-photo',
	'application/x-affinity-publisher',
	'application/x-affinity',
	'application/x-affinity-template'
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
	mp4: 'video/mp4',
	m4v: 'video/mp4',
	mov: 'video/quicktime',
	webm: 'video/webm',
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
	otp: 'application/vnd.oasis.opendocument.presentation-template',
	'7z': 'application/x-7z-compressed',
	rar: 'application/vnd.rar',
	tar: 'application/x-tar',
	gz: 'application/gzip',
	tgz: 'application/gzip',
	psd: 'image/vnd.adobe.photoshop',
	psb: 'image/vnd.adobe.photoshop',
	ai: 'application/illustrator',
	eps: 'application/postscript',
	indd: 'application/x-indesign',
	idml: 'application/vnd.adobe.indesign-idml-package',
	xd: 'application/vnd.adobe.xd',
	aep: 'application/vnd.adobe.aftereffects.project',
	prproj: 'application/vnd.adobe.premiere.project',
	afdesign: 'application/x-affinity-designer',
	afphoto: 'application/x-affinity-photo',
	afpub: 'application/x-affinity-publisher',
	af: 'application/x-affinity',
	aftemplate: 'application/x-affinity-template'
};

/**
 * Andere Schreibweisen derselben Typen, die Browser bzw. Betriebssysteme melden (z. B. Chrome unter Windows
 * `application/x-zip-compressed`) → einheitlicher Typ der Allowlist.
 */
export const CONTENT_TYPE_ALIASES: Readonly<Record<string, string>> = {
	'application/x-zip-compressed': 'application/zip',
	'application/x-zip': 'application/zip',
	'multipart/x-zip': 'application/zip',
	'application/x-rar-compressed': 'application/vnd.rar',
	'application/x-rar': 'application/vnd.rar',
	'application/x-gzip': 'application/gzip',
	'application/x-gtar': 'application/x-tar',
	'application/x-photoshop': 'image/vnd.adobe.photoshop',
	'application/photoshop': 'image/vnd.adobe.photoshop',
	'application/psd': 'image/vnd.adobe.photoshop',
	'image/psd': 'image/vnd.adobe.photoshop',
	'image/x-photoshop': 'image/vnd.adobe.photoshop',
	'application/x-illustrator': 'application/illustrator',
	'application/eps': 'application/postscript',
	'application/x-eps': 'application/postscript',
	'image/eps': 'application/postscript',
	'image/x-eps': 'application/postscript'
};

/**
 * Endungen, bei denen die Endung den gemeldeten Typ schlägt: Browser melden für Archive, Adobe- und
 * Affinity-Dateien je nach System Unterschiedliches (`application/octet-stream`, `application/postscript`
 * für `.ai`, `application/x-compressed` …). Der Inhalt wird danach trotzdem geprüft (Magic Bytes).
 */
const EXTENSION_WINS = new Set([
	'zip',
	'7z',
	'rar',
	'tar',
	'gz',
	'tgz',
	'psd',
	'psb',
	'ai',
	'eps',
	'indd',
	'idml',
	'xd',
	'aep',
	'prproj',
	'afdesign',
	'afphoto',
	'afpub',
	'af',
	'aftemplate'
]);

/** Typ ohne Parameter, klein geschrieben, Aliasse vereinheitlicht; leer → `''` */
export function canonicalContentType(type: string | null | undefined): string {
	const t = (type ?? '').split(';')[0]!.trim().toLowerCase();
	return CONTENT_TYPE_ALIASES[t] ?? t;
}

/**
 * Typ einer hochgeladenen Datei aus Name und Browser-Angabe: bekannte Endung bei fehlendem/allgemeinem Typ
 * (oder bei Archiven/Grafikformaten immer), sonst der gemeldete Typ (vereinheitlicht); `''` = unbekannt.
 */
export function resolveContentType(
	name: string | null | undefined,
	reported?: string | null
): string {
	const t = canonicalContentType(reported);
	const n = name ?? '';
	const dot = n.lastIndexOf('.');
	const ext = dot >= 0 ? n.slice(dot + 1).toLowerCase() : '';
	const byExt = EXTENSION_CONTENT_TYPES[ext];
	if (byExt && (!t || t === 'application/octet-stream' || EXTENSION_WINS.has(ext))) return byExt;
	return t;
}

/**
 * `accept`-Attribut für einen Dateidialog: Typen plus passende Endungen – sonst graut das System Dateien
 * aus, deren Typ es nicht kennt (z. B. `.afdesign`). `undefined` bei Platzhaltern (`*`, `*\/*`).
 */
export function acceptForContentTypes(types: readonly string[]): string | undefined {
	if (!types.length || types.some((t) => t === '*' || t === '*/*')) return undefined;
	const set = new Set(types.map((t) => t.toLowerCase()));
	const exts = Object.entries(EXTENSION_CONTENT_TYPES)
		.filter(
			([, type]) =>
				set.has(type) || [...set].some((a) => a.endsWith('/*') && type.startsWith(a.slice(0, -1)))
		)
		.map(([ext]) => `.${ext}`);
	return [...set, ...exts].join(',');
}
