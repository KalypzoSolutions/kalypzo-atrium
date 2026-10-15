import { z } from 'zod';
import type { SettingScope } from '$lib/sdk/types';

export interface SettingDefinition {
	key: string;
	label: string;
	description?: string;
	schema: z.ZodType;
	default?: unknown;
	/** Wird verschluesselt gespeichert und niemals an Clients uebertragen */
	secret?: boolean;
	scope: SettingScope;
	group: string;
}

const str = (max = 200) => z.string().trim().max(max);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const cssLength = z.string().regex(/^\d+(\.\d+)?(mm|cm|in|px)$/);
const urlOrEmpty = z.union([z.literal(''), z.string().url()]);

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
	g({
		key: 'core.design.logoFileId',
		label: 'Logo (Datei-ID im Storage)',
		schema: z.string().max(64),
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
		label: 'Max. Dateigroesse (MB)',
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
		label: 'Fusszeile (Mitte)',
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
		key: 'core.user.pageSize',
		label: 'Eintraege pro Seite',
		schema: z.coerce.number().int().min(10).max(200),
		default: 25,
		scope: 'user',
		group: 'user'
	})
];
