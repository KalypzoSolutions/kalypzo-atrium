/**
 * Oeffentliche, seiteneffektfreie Typen des Core-SDK.
 * Darf sowohl von Server- als auch Client-Code importiert werden.
 */
import type { z } from 'zod';

export type ActorType = 'user' | 'api_key' | 'system';

export interface Actor {
	type: ActorType;
	id: string | null;
	name: string;
}

/** Sicherheitskontext einer Anfrage. Wird von den Server-Hooks bzw. dem API-Router erzeugt. */
export interface RequestContext {
	actor: Actor;
	/** Benutzer-ID (bei API-Keys: Eigentuemer des Keys) */
	userId: string | null;
	/** Wirksame Berechtigungen (bei API-Keys: Scopes geschnitten mit Eigentuemer-Rechten) */
	permissions: ReadonlySet<string>;
	ip: string | null;
	requestId: string;
}

export interface ModuleNavigationItem {
	label: string;
	icon: string;
	path: string;
	/** Optional: nur sichtbar mit dieser Berechtigung */
	permission?: string;
	/** Optional: Eintraege mit gleichem Gruppennamen erscheinen als aufklappbare Gruppe */
	group?: string;
	/** Optional: Icon der Gruppe (nimmt den ersten gesetzten Wert der Gruppe) */
	groupIcon?: string;
}

export interface ModuleSettingDefinition {
	key: string;
	label: string;
	description?: string;
	schema: z.ZodType;
	default?: unknown;
	secret?: boolean;
}

export interface ModuleManifest {
	/** Kleinbuchstaben, Ziffern und Bindestriche; `core` ist reserviert */
	id: string;
	name: string;
	description?: string;
	version: string;
	dependencies: string[];
	permissions: string[];
	navigation: ModuleNavigationItem[];
}

export type SettingScope = 'global' | 'user';

export interface ApiErrorBody {
	error: {
		code: string;
		message: string;
		details?: unknown;
		requestId?: string;
	};
}

export type PdfFormat = 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal';
export type PdfOrientation = 'portrait' | 'landscape';

export interface PdfMargins {
	top: string;
	right: string;
	bottom: string;
	left: string;
}

export type PdfBlock =
	| { type: 'heading'; text: string; level?: 1 | 2 | 3 }
	| { type: 'paragraph'; text: string }
	| { type: 'list'; items: string[]; ordered?: boolean }
	| {
			type: 'table';
			columns: string[];
			rows: string[][];
			/** `grid`: schwarzes Gitter wie in Formularen (Kopfzeile `caption`, optional Summenzeile) */
			variant?: 'grid';
			/** Kopfzeile ueber der Tabelle: breite Zelle links, schmale Zelle rechts (z. B. Summe) */
			caption?: { left: string; right?: string };
			/** Ausrichtung je Spalte (Standard links) */
			align?: ('left' | 'right' | 'center')[];
			/** Relative Spaltenbreiten (gleiche Laenge wie `columns`) */
			widths?: number[];
			/** Fett hervorgehobene Abschlusszeile (gleiche Laenge wie `columns`) */
			totalRow?: string[];
			/** Spaltenkopfzeile weglassen (z. B. wenn `caption` schon beschriftet) */
			noHeader?: boolean;
	  }
	| { type: 'pageBreak' };

export type PdfContent = PdfBlock[];

/** Anlage, die hinter das erzeugte Dokument gehaengt wird (PDF oder Bild). */
export interface PdfAttachment {
	/** Kennzeichnung auf der Anlagenseite, z. B. `Beleg Nr. 3` */
	label: string;
	/** Bezeichnung unter der Kennzeichnung, z. B. Buchungstext */
	caption?: string;
	contentType: string;
	data: Uint8Array;
}

export interface PdfGenerateInput {
	template?: string;
	title: string;
	content: PdfContent;
	format?: PdfFormat;
	orientation?: PdfOrientation;
	margins?: Partial<PdfMargins>;
	showHeader?: boolean;
	showFooter?: boolean;
	/**
	 * Empfaengeradresse (max. 6 Zeilen, je max. 60 Zeichen) fuer Briefvorlagen mit Adressfeld; von
	 * anderen Vorlagen ignoriert.
	 */
	recipient?: string[];
	/**
	 * Anlagen, die nach dem Inhalt angehaengt werden (application/pdf, image/png|jpeg|webp). Jede
	 * Anlage beginnt auf einer neuen Seite und traegt `label`. Nicht lesbare Anlagen werden
	 * uebersprungen (Seite mit Hinweis).
	 */
	attachments?: PdfAttachment[];
	/** Modul, in dessen Namen das Dokument erzeugt wird (Pflicht, wenn `store` gesetzt ist) */
	module?: string;
	/** Optional: Ergebnis im Storage ablegen */
	store?: { path: string };
}

export interface StoredFile {
	id: string;
	module: string;
	path: string;
	name: string;
	size: number;
	contentType: string;
	createdAt: string;
}

export interface PdfResult {
	buffer: Uint8Array;
	contentType: 'application/pdf';
	fileName: string;
	stored?: StoredFile;
}

export interface AiGenerateInput {
	module: string;
	prompt: string;
	system?: string;
	/** `configured-default` verwendet das zentral konfigurierte Standardmodell */
	model?: string;
	temperature?: number;
	maxOutputTokens?: number;
	/** Dateien aus dem zentralen Storage, die mitverarbeitet werden */
	files?: { module: string; path: string }[];
	/** Bilder als Data-URL oder https-URL */
	images?: string[];
}

export interface AiUsage {
	model: string;
	inputTokens: number;
	outputTokens: number;
	estimatedCostUsd: number;
}

export interface AiGenerateResult {
	text: string;
	usage: AiUsage;
}
