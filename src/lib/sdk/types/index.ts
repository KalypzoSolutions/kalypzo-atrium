/**
 * Öffentliche, seiteneffektfreie Typen des Core-SDK.
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
	/** Benutzer-ID (bei API-Keys: Eigentümer des Keys) */
	userId: string | null;
	/** Wirksame Berechtigungen (bei API-Keys: Scopes geschnitten mit Eigentümer-Rechten) */
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
	/** Optional: sichtbar mit mindestens einem dieser Rechte (ersetzt `permission`, wenn gesetzt) */
	anyPermission?: string[];
	/** Optional: Einträge mit gleichem Gruppennamen erscheinen als aufklappbare Gruppe */
	group?: string;
	/** Optional: Icon der Gruppe (nimmt den ersten gesetzten Wert der Gruppe) */
	groupIcon?: string;
	/** Optional: Eintrag erscheint in der Gruppe „Administration“ (z. B. Modul-Einstellungen) */
	admin?: boolean;
	/**
	 * Optional (nur mit `admin`): Seite ersetzt das generische Formular unter Einstellungen → Module
	 * (dort erscheint dann nur ein Link)
	 */
	settingsPage?: boolean;
	/**
	 * Optional: Position in der Seitenleiste über alle Module hinweg (kleiner = weiter oben, ohne Angabe 1000;
	 * bei gleichem Wert gilt die Reihenfolge der Registrierung)
	 */
	order?: number;
}

export interface ModuleSettingDefinition {
	key: string;
	label: string;
	description?: string;
	schema: z.ZodType;
	default?: unknown;
	secret?: boolean;
	/**
	 * Nur bei `secret`: Schlüssel desselben Moduls (z. B. Host, Benutzer), an die das Secret gebunden ist.
	 * Ändert sich einer davon, wird das Secret verworfen (wie `SECRET_BINDINGS` im Core), damit ein
	 * gespeichertes Passwort nicht an einen fremden Server geht.
	 */
	secretBoundTo?: string[];
	/**
	 * Recht zum Schreiben dieser Einstellung (auch über `PUT /api/v1/settings`). Ohne Angabe:
	 * `<modul>.settings.manage`, falls das Modul dieses Recht deklariert, sonst `core.settings.manage`.
	 */
	writePermission?: string;
}

export interface ModuleManifest {
	/** Kleinbuchstaben, Ziffern und Bindestriche; `core` ist reserviert */
	id: string;
	name: string;
	description?: string;
	version: string;
	dependencies: string[];
	/**
	 * Module, deren Dienste genutzt werden, WENN sie aktiv sind (`core.modules.useOptional`). Keine
	 * Aktivierungs-Reihenfolge, kein Zyklus-Check – für Rückkanäle (z. B. Kasse -> Aktionen).
	 */
	optionalDependencies?: string[];
	permissions: string[];
	/**
	 * Beschreibung je Recht aus `permissions` (Anzeige unter Administration → Berechtigungen und bei
	 * API-Key-Scopes). Wird bei jedem Start in die Datenbank übernommen.
	 */
	permissionDescriptions?: Record<string, string>;
	navigation: ModuleNavigationItem[];
	/**
	 * Standard-Rechte für Rollen (Rollenname -> Rechte aus `permissions`). Die Rolle wird per Name gesucht
	 * bzw. angelegt (kein System). Jedes (Modul, Rolle, Recht) wird **einmalig** vergeben (Marker
	 * `role_grant_applied`): bewusst entzogene Rechte kommen nicht zurück. Gleichwertig zu
	 * `ModuleDefinition.defaultRoleGrants`.
	 */
	defaultRoleGrants?: Record<string, string[]>;
	/**
	 * Ämter, die das Modul als **Vorlage** mitbringt (nur wirksam, wenn das Modul `offices` aktiv ist).
	 * Das Amt wird einmalig angelegt und ist danach ein normales Amt; Benachrichtigungen des Moduls
	 * gehen an dessen Inhaber*innen (`OfficesService.notify`). Schlüssel `[a-z][a-z0-9-]*`.
	 */
	offices?: ModuleOfficeTemplate[];
}

/** Benachrichtigung, die ein Modul-Amt erhalten kann (Modus je Person im Profil: sofort/täglich/aus) */
export interface ModuleOfficeNotification {
	key: string;
	label: string;
	description?: string;
}

export interface ModuleOfficeTemplate {
	key: string;
	name: string;
	description?: string;
	notifications: ModuleOfficeNotification[];
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

/**
 * Tabellenzelle: einfacher Text oder Zelle mit Zusammenfassung über mehrere Spalten (`colspan`) bzw.
 * Zeilen (`rowspan`). Eine Zeile braucht nur so viele Einträge, wie Zellen entstehen – Spalten, die
 * von einer Zelle darüber (`rowspan`) belegt sind, werden übersprungen; fehlende Zellen am Zeilenende
 * werden leer aufgefüllt. Werte werden auf das Raster geklemmt (mind. 1, höchstens bis zum Rand).
 */
export type PdfTableCell =
	| string
	| {
			text: string;
			colspan?: number;
			rowspan?: number;
			/** Ausrichtung dieser Zelle (Standard: die der Spalte, in der die Zelle beginnt) */
			align?: 'left' | 'right' | 'center';
			/** Fett (die Summenzeile ist ohnehin fett) */
			bold?: boolean;
	  };

export type PdfBlock =
	| { type: 'heading'; text: string; level?: 1 | 2 | 3 }
	| { type: 'paragraph'; text: string }
	| { type: 'list'; items: string[]; ordered?: boolean }
	| {
			type: 'table';
			columns: string[];
			rows: PdfTableCell[][];
			/** `grid`: schwarzes Gitter wie in Formularen (Kopfzeile `caption`, optional Summenzeile) */
			variant?: 'grid';
			/** Kopfzeile über der Tabelle: breite Zelle links, schmale Zelle rechts (z. B. Summe) */
			caption?: { left: string; right?: string };
			/** Ausrichtung je Spalte (Standard links) */
			align?: ('left' | 'right' | 'center')[];
			/** Relative Spaltenbreiten (gleiche Länge wie `columns`) */
			widths?: number[];
			/** Fett hervorgehobene Abschlusszeile (deckt alle Spalten ab, ggf. mit `colspan`) */
			totalRow?: PdfTableCell[];
			/** Spaltenkopfzeile weglassen (z. B. wenn `caption` schon beschriftet) */
			noHeader?: boolean;
	  }
	/** Bild als `data:`-URL (nur PNG/JPEG, z. B. QR-Code), Breite in mm */
	| { type: 'image'; dataUrl: string; widthMm: number; alt?: string; align?: 'left' | 'center' }
	/**
	 * Zweispaltiger Block ohne Rahmen: optional Bild links (z. B. QR-Code), rechts Beschriftung, ein
	 * hervorgehobener Wert (z. B. Code), Zusatzzeilen und ein im PDF anklickbarer Link (nur http/https;
	 * das Bild wird mitverlinkt).
	 */
	| {
			type: 'box';
			image?: { dataUrl: string; widthMm: number; alt?: string };
			label?: string;
			value?: string;
			lines?: string[];
			/** Beschriftung über dem Link */
			linkLabel?: string;
			/** Anzeigetext (Standard: href); bricht bei langen Adressen überall um */
			link?: { href: string; text?: string };
	  }
	| { type: 'pageBreak' };

export type PdfContent = PdfBlock[];

/** Anlage, die hinter das erzeugte Dokument gehängt wird (PDF oder Bild). */
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
	/**
	 * Seitenausrichtung. Bei Vorlagen mit festem Seitenlayout (Briefvorlagen wie `stamm-brief`,
	 * `stamm-briefkopf`, `stamm-briefkopf-quer`) ignoriert; dort bestimmt die Vorlage die Ausrichtung.
	 */
	orientation?: PdfOrientation;
	margins?: Partial<PdfMargins>;
	showHeader?: boolean;
	showFooter?: boolean;
	/**
	 * Empfängeradresse (max. 6 Zeilen, je max. 60 Zeichen) für Briefvorlagen mit Adressfeld; von
	 * anderen Vorlagen ignoriert.
	 */
	recipient?: string[];
	/**
	 * Anlagen, die nach dem Inhalt angehängt werden (application/pdf, image/png|jpeg|webp). Jede
	 * Anlage beginnt auf einer neuen Seite und trägt `label`. Nicht lesbare Anlagen werden
	 * übersprungen (Seite mit Hinweis).
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
export type * from './search';
