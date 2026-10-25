import { z } from 'zod';
import type { SettingScope } from '$lib/sdk/types';
import { DASHBOARD_KEY_PATTERN, DASHBOARD_LAYOUT_MAX } from '$lib/sdk/client/dashboard-widgets';

export interface SettingDefinition {
	key: string;
	label: string;
	description?: string;
	schema: z.ZodType;
	default?: unknown;
	/** Wird verschlüsselt gespeichert und niemals an Clients übertragen */
	secret?: boolean;
	scope: SettingScope;
	group: string;
	/**
	 * Recht zum Schreiben (nur globale Einstellungen). Standard: `core.settings.manage`; Modul-Schlüssel
	 * bekommen `<modul>.settings.manage`, wenn das Modul dieses Recht deklariert (siehe `service.ts`).
	 */
	writePermission?: string;
}

/**
 * Secrets, die an ein Ziel gebunden sind (#15): Ändert sich ein Ziel-Schlüssel (Host, Port, Benutzer,
 * URL), wird das zugehörige Secret verworfen – außer es wird im selben Speichervorgang neu gesetzt.
 * Sonst ließe sich ein gespeichertes Passwort/API-Key an einen fremden Server schicken.
 */
export const SECRET_BINDINGS: { targets: string[]; secrets: string[] }[] = [
	{
		targets: ['core.smtp.host', 'core.smtp.port', 'core.smtp.user'],
		secrets: ['core.smtp.password']
	},
	{ targets: ['core.ai.baseUrl'], secrets: ['core.ai.apiKey'] },
	{
		targets: ['core.storage.endpoint'],
		secrets: ['core.storage.accessKeyId', 'core.storage.secretAccessKey']
	}
];

const str = (max = 200) => z.string().trim().max(max);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const cssLength = z.string().regex(/^\d+(\.\d+)?(mm|cm|in|px)$/);
const urlOrEmpty = z.union([z.literal(''), z.string().url()]);
const dashboardKey = z.string().max(80).regex(DASHBOARD_KEY_PATTERN);

/** Vereinsnachweis wie in der PDF-Fußzeile */
export const DEFAULT_MAIL_FOOTER =
	'Die Christliche Pfadfinderschaft Deutschland ist Mitglied der AEJ (Arbeitsgemeinschaft der Evangelischen Jugend in Deutschland e.V.), anerkannt nach §75 SGB VIII und in das Vereinsregister Heilbad Heiligenstadt unter Nr. 400532 eingetragen.';

type Def = Omit<SettingDefinition, 'scope'> & { scope?: SettingScope };
const g = (d: Def): SettingDefinition => ({ scope: 'global', ...d });

export const CORE_SETTINGS: SettingDefinition[] = [
	// System / Organisation
	g({
		key: 'core.system.name',
		label: 'Systemname',
		schema: str(80).min(1),
		default: 'EP Intern',
		group: 'system'
	}),
	g({
		key: 'core.organization.name',
		label: 'Organisation',
		schema: str(120),
		default: '',
		group: 'system'
	}),
	g({
		key: 'core.organization.address',
		label: 'Anschrift',
		schema: str(400),
		default: '',
		group: 'system'
	}),
	g({
		key: 'core.organization.email',
		label: 'Kontakt-E-Mail',
		schema: z.union([z.literal(''), z.string().email()]),
		default: '',
		group: 'system'
	}),
	g({
		key: 'core.organization.phone',
		label: 'Telefon',
		schema: str(40),
		default: '',
		group: 'system'
	}),

	// Rechtliche Links (Login-Fußzeile, öffentliche Seiten `/p/*`, Anmeldeformulare; Issue #28)
	g({
		key: 'core.legal.privacyUrl',
		label: 'Datenschutzerklärung (URL)',
		description:
			'Link auf die Datenschutzerklärung des Stammes. Erscheint auf der Anmeldeseite und allen öffentlichen Seiten; Anmeldeformulare ohne eigenen Link nutzen ihn.',
		schema: urlOrEmpty,
		default: '',
		group: 'system'
	}),
	g({
		key: 'core.legal.imprintUrl',
		label: 'Impressum (URL)',
		description:
			'Link auf das Impressum. Erscheint auf der Anmeldeseite und allen öffentlichen Seiten.',
		schema: urlOrEmpty,
		default: '',
		group: 'system'
	}),

	// Aufbewahrungsfristen (Core-Job `core.housekeeping`, täglich)
	g({
		key: 'core.retention.apiLogDays',
		label: 'API-Protokoll aufbewahren (Tage)',
		description:
			'Einträge im API-Zugriffsprotokoll (Pfad, IP-Adresse, Akteur) werden danach gelöscht. 1–3650 Tage.',
		schema: z.coerce.number().int().min(1).max(3650),
		default: 30,
		group: 'system'
	}),
	g({
		key: 'core.retention.auditIpDays',
		label: 'IP-Adressen im Audit-Log aufbewahren (Tage)',
		description:
			'Danach wird die IP-Adresse aus Audit-Einträgen entfernt; der Eintrag selbst bleibt. 1–3650 Tage.',
		schema: z.coerce.number().int().min(1).max(3650),
		default: 90,
		group: 'system'
	}),
	g({
		key: 'core.retention.auditDays',
		label: 'Audit-Log aufbewahren (Tage)',
		description:
			'Audit-Einträge werden danach gelöscht. 0 = nie löschen, sonst mindestens 30 Tage (höchstens 36500).',
		schema: z.coerce
			.number()
			.int()
			.min(0)
			.max(36500)
			.refine((v) => v === 0 || v >= 30, 'Bitte 0 (nie) oder mindestens 30 Tage angeben'),
		default: 730,
		group: 'system'
	}),
	g({
		key: 'core.design.logoFileId',
		label: 'Logo (Datei-ID im Storage)',
		// Leer oder UUID einer Datei aus `core/branding/` (Logo-Upload); PDFs prüfen den Bereich zusätzlich.
		schema: z.union([z.literal(''), z.uuid()]),
		default: '',
		group: 'design'
	}),
	g({
		key: 'core.design.accentColor',
		label: 'Akzentfarbe',
		schema: hexColor,
		default: '#2563eb',
		group: 'design'
	}),

	// SMTP
	g({ key: 'core.smtp.host', label: 'SMTP-Host', schema: str(255), default: '', group: 'smtp' }),
	g({
		key: 'core.smtp.port',
		label: 'SMTP-Port',
		schema: z.coerce.number().int().min(1).max(65535),
		default: 587,
		group: 'smtp'
	}),
	g({
		key: 'core.smtp.secure',
		label: 'TLS direkt (Port 465)',
		schema: z.boolean(),
		default: false,
		group: 'smtp'
	}),
	g({
		key: 'core.smtp.user',
		label: 'SMTP-Benutzer',
		schema: str(255),
		default: '',
		group: 'smtp'
	}),
	g({
		key: 'core.smtp.password',
		label: 'SMTP-Passwort',
		schema: str(500),
		default: '',
		secret: true,
		group: 'smtp'
	}),
	g({
		key: 'core.smtp.from',
		label: 'Absenderadresse',
		schema: str(255),
		default: '',
		group: 'smtp'
	}),

	// E-Mail-Layout
	g({
		key: 'core.mail.layoutEnabled',
		label: 'Stamm-Layout für E-Mails verwenden',
		description:
			'Kopf mit Lilie und Vereinsname, Signatur und Fußzeile für alle ausgehenden E-Mails.',
		schema: z.boolean(),
		default: true,
		group: 'mail'
	}),
	g({
		key: 'core.mail.showEmblem',
		label: 'Wappen im Kopf anzeigen',
		schema: z.boolean(),
		default: true,
		group: 'mail'
	}),
	g({
		key: 'core.mail.signature',
		label: 'Signatur',
		description:
			'Wird unter jeden Nachrichtentext gesetzt, z. B. „Gut Pfad!“. Leer = keine Signatur.',
		schema: str(400),
		default: '',
		group: 'mail'
	}),
	g({
		key: 'core.mail.footerText',
		label: 'Fußzeile',
		description: 'Kleingedruckter Vereinsnachweis unter jeder E-Mail. Leer = keine Fußzeile.',
		schema: str(800),
		default: DEFAULT_MAIL_FOOTER,
		group: 'mail'
	}),

	// Storage
	g({
		key: 'core.storage.endpoint',
		label: 'S3-Endpoint (leer = AWS)',
		schema: urlOrEmpty,
		default: '',
		group: 'storage'
	}),
	g({
		key: 'core.storage.region',
		label: 'Region',
		schema: str(60),
		default: 'auto',
		group: 'storage'
	}),
	g({
		key: 'core.storage.bucket',
		label: 'Bucket',
		schema: str(100),
		default: '',
		group: 'storage'
	}),
	g({
		key: 'core.storage.accessKeyId',
		label: 'Access Key ID',
		schema: str(200),
		default: '',
		secret: true,
		group: 'storage'
	}),
	g({
		key: 'core.storage.secretAccessKey',
		label: 'Secret Access Key',
		schema: str(500),
		default: '',
		secret: true,
		group: 'storage'
	}),
	g({
		key: 'core.storage.forcePathStyle',
		label: 'Path-Style-URLs (MinIO)',
		schema: z.boolean(),
		default: false,
		group: 'storage'
	}),
	g({
		key: 'core.storage.maxFileSizeMb',
		label: 'Max. Dateigröße (MB)',
		schema: z.coerce.number().int().min(1).max(5000),
		default: 50,
		group: 'storage'
	}),
	g({
		key: 'core.storage.allowedContentTypes',
		label: 'Erlaubte Dateitypen (leer = Standardliste)',
		schema: z.array(z.string().max(100)).max(100),
		default: [],
		group: 'storage'
	}),

	// KI
	g({
		key: 'core.ai.apiKey',
		label: 'OpenAI API-Key',
		schema: str(500),
		default: '',
		secret: true,
		group: 'ai'
	}),
	g({
		key: 'core.ai.baseUrl',
		label: 'API Base-URL (optional)',
		schema: urlOrEmpty,
		default: '',
		group: 'ai'
	}),
	g({
		key: 'core.ai.defaultModel',
		label: 'Standardmodell',
		schema: str(100).min(1),
		default: 'gpt-4o-mini',
		group: 'ai'
	}),
	g({
		key: 'core.ai.allowedModels',
		label: 'Erlaubte Modelle (leer = alle)',
		schema: z.array(str(100)).max(50),
		default: [],
		group: 'ai'
	}),
	g({
		key: 'core.ai.allowedModules',
		label: 'Module mit KI-Zugriff (leer = alle)',
		schema: z.array(str(40)).max(100),
		default: [],
		group: 'ai'
	}),
	g({
		key: 'core.ai.monthlyTokenLimit',
		label: 'Monatliches Token-Limit je Modul (0 = unbegrenzt)',
		schema: z.coerce.number().int().min(0),
		default: 0,
		group: 'ai'
	}),
	g({
		key: 'core.ai.monthlyCostLimitUsd',
		label: 'Monatliches Kostenlimit je Modul in USD (0 = unbegrenzt)',
		schema: z.coerce.number().min(0),
		default: 0,
		group: 'ai'
	}),
	g({
		key: 'core.ai.requestsPerMinute',
		label: 'Max. Anfragen pro Minute (gesamt)',
		schema: z.coerce.number().int().min(1).max(10000),
		default: 60,
		group: 'ai'
	}),
	g({
		key: 'core.ai.pricing',
		label: 'Preise je 1M Tokens in USD (Modell -> input/output)',
		schema: z.record(z.string(), z.object({ input: z.number().min(0), output: z.number().min(0) })),
		default: {},
		group: 'ai'
	}),

	// PDF
	g({
		key: 'core.pdf.defaultFormat',
		label: 'Standard-Seitenformat',
		schema: z.enum(['A3', 'A4', 'A5', 'Letter', 'Legal']),
		default: 'A4',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.defaultOrientation',
		label: 'Standard-Ausrichtung',
		schema: z.enum(['portrait', 'landscape']),
		default: 'portrait',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.marginTop',
		label: 'Rand oben',
		schema: cssLength,
		default: '25mm',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.marginRight',
		label: 'Rand rechts',
		schema: cssLength,
		default: '18mm',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.marginBottom',
		label: 'Rand unten',
		schema: cssLength,
		default: '22mm',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.marginLeft',
		label: 'Rand links',
		schema: cssLength,
		default: '18mm',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.headerText',
		label: 'Kopfzeile (rechts)',
		schema: str(200),
		default: '',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.footerText',
		label: 'Fußzeile (Mitte)',
		schema: str(200),
		default: '',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.showLogo',
		label: 'Logo im Header',
		schema: z.boolean(),
		default: true,
		group: 'pdf'
	}),

	// Benachrichtigungen / Web Push (core.notifications)
	g({
		key: 'core.push.enabled',
		label: 'Push-Benachrichtigungen',
		description:
			'Erlaubt Benachrichtigungen direkt aufs Gerät (Web Push, auch als App auf dem Home-Bildschirm). Aus: alles geht per E-Mail.',
		schema: z.boolean(),
		default: true,
		group: 'push'
	}),
	g({
		key: 'core.push.vapidPublicKey',
		label: 'Öffentlicher Push-Schlüssel (VAPID)',
		description: 'Wird automatisch erzeugt.',
		schema: z.union([z.literal(''), z.string().regex(/^[A-Za-z0-9_-]{80,100}$/)]),
		default: '',
		group: 'push'
	}),
	g({
		key: 'core.push.vapidPrivateKey',
		label: 'Privater Push-Schlüssel (VAPID)',
		description: 'Wird automatisch erzeugt und verschlüsselt gespeichert.',
		schema: z.union([z.literal(''), z.string().regex(/^[A-Za-z0-9_-]{40,50}$/)]),
		default: '',
		secret: true,
		group: 'push'
	}),

	// Benutzer
	g({
		key: 'core.user.theme',
		label: 'Darstellung',
		schema: z.enum(['light', 'dark', 'system']),
		default: 'system',
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.accentColor',
		label: 'Eigene Akzentfarbe',
		description: 'Leer = Akzentfarbe des Systems.',
		schema: z.union([z.literal(''), hexColor]),
		default: '',
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.density',
		label: 'Dichte',
		schema: z.enum(['comfortable', 'compact']),
		default: 'comfortable',
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.startPage',
		label: 'Startseite',
		description: 'Seite nach der Anmeldung (nur erlaubte Seiten werden verwendet).',
		schema: z
			.string()
			.max(200)
			.regex(/^\/(?!\/)[a-z0-9\-/]*$/),
		default: '/dashboard',
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.pageSize',
		label: 'Einträge pro Seite',
		schema: z.coerce.number().int().min(10).max(200),
		default: 25,
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.dashboard',
		label: 'Dashboard-Anordnung',
		description: 'Reihenfolge und ausgeblendete Kacheln (`<modul>:<kachel>`); leer = Standard.',
		schema: z
			.object({
				order: z.array(dashboardKey).max(DASHBOARD_LAYOUT_MAX),
				hidden: z.array(dashboardKey).max(DASHBOARD_LAYOUT_MAX)
			})
			.strict()
			.nullable(),
		default: null,
		scope: 'user',
		group: 'user'
	})
];
