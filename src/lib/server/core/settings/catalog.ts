import { z } from 'zod';
import { hasMessage, t } from '$lib/i18n';
import type { SettingScope } from '$lib/sdk/types';
import { activeThemeSchema, themeFavoritesSchema, userThemesSchema } from '$lib/appearance/schema';
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

/** Fußzeile unter E-Mails: neutral leer (Profil-Module einer Organisation geben per `settingDefaults` einen Text vor) */
export const DEFAULT_MAIL_FOOTER = '';

type Def = Omit<SettingDefinition, 'scope' | 'label' | 'description'> & { scope?: SettingScope };

/** Textschlüssel einer Core-Einstellung: `settings.<schlüssel>.label` bzw. `.description` */
export function settingTextKey(key: string, part: 'label' | 'description'): string {
	return `settings.${key}.${part}`;
}

/**
 * Core-Einstellung mit übersetzten Texten: `label`/`description` sind Getter und liefern beim Zugriff die
 * Sprache des laufenden Requests (Texte in `messages/<sprache>/settings.json`, nie beim Import einfrieren).
 */
const g = (d: Def): SettingDefinition => ({
	scope: 'global',
	...d,
	get label() {
		return t(settingTextKey(d.key, 'label'));
	},
	get description() {
		const k = settingTextKey(d.key, 'description');
		return hasMessage(k, 'de') ? t(k) : undefined;
	}
});

export const CORE_SETTINGS: SettingDefinition[] = [
	// Modul-Installation (Kalypzo Atrium)
	g({
		key: 'core.modules.githubToken',
		schema: str(400),
		default: '',
		secret: true,
		group: 'modules',
		writePermission: 'core.modules.install'
	}),
	g({
		key: 'core.modules.allowedSources',
		schema: str(2000),
		default: '',
		group: 'modules',
		writePermission: 'core.modules.install'
	}),
	// System / Organisation
	g({
		key: 'core.system.name',
		schema: str(80).min(1),
		default: 'Kalypzo Atrium',
		group: 'system'
	}),
	g({
		key: 'core.system.locale',
		schema: z.enum(['auto', 'de', 'en']),
		default: 'auto',
		group: 'system'
	}),
	g({
		key: 'core.org.everyoneLabel',
		schema: str(60),
		default: '',
		group: 'system'
	}),
	g({
		key: 'core.organization.name',
		schema: str(120),
		default: '',
		group: 'system'
	}),
	g({
		key: 'core.organization.address',
		schema: str(400),
		default: '',
		group: 'system'
	}),
	g({
		key: 'core.organization.email',
		schema: z.union([z.literal(''), z.string().email()]),
		default: '',
		group: 'system'
	}),
	g({
		key: 'core.organization.phone',
		schema: str(40),
		default: '',
		group: 'system'
	}),

	// Rechtliche Links (Login-Fußzeile, öffentliche Seiten `/p/*`, Anmeldeformulare; Issue #28)
	g({
		key: 'core.legal.privacyUrl',
		schema: urlOrEmpty,
		default: '',
		group: 'system'
	}),
	g({
		key: 'core.legal.imprintUrl',
		schema: urlOrEmpty,
		default: '',
		group: 'system'
	}),

	// Aufbewahrungsfristen (Core-Job `core.housekeeping`, täglich)
	g({
		key: 'core.retention.apiLogDays',
		schema: z.coerce.number().int().min(1).max(3650),
		default: 30,
		group: 'system'
	}),
	g({
		key: 'core.retention.auditIpDays',
		schema: z.coerce.number().int().min(1).max(3650),
		default: 90,
		group: 'system'
	}),
	g({
		key: 'core.retention.auditDays',
		schema: z.coerce
			.number()
			.int()
			.min(0)
			.max(36500)
			.refine((v) => v === 0 || v >= 30, { error: () => t('settings.validation.auditDays') }),
		default: 730,
		group: 'system'
	}),
	g({
		key: 'core.design.logoFileId',
		// Leer oder UUID einer Datei aus `core/branding/` (Logo-Upload); PDFs prüfen den Bereich zusätzlich.
		schema: z.union([z.literal(''), z.uuid()]),
		default: '',
		group: 'design'
	}),
	g({
		key: 'core.design.iconBackground',
		schema: hexColor,
		default: '#ffffff',
		group: 'design'
	}),
	g({
		key: 'core.design.accentColor',
		schema: hexColor,
		default: '#2563eb',
		group: 'design'
	}),

	// SMTP
	g({ key: 'core.smtp.host', schema: str(255), default: '', group: 'smtp' }),
	g({
		key: 'core.smtp.port',
		schema: z.coerce.number().int().min(1).max(65535),
		default: 587,
		group: 'smtp'
	}),
	g({
		key: 'core.smtp.secure',
		schema: z.boolean(),
		default: false,
		group: 'smtp'
	}),
	g({
		key: 'core.smtp.user',
		schema: str(255),
		default: '',
		group: 'smtp'
	}),
	g({
		key: 'core.smtp.password',
		schema: str(500),
		default: '',
		secret: true,
		group: 'smtp'
	}),
	g({
		key: 'core.smtp.from',
		schema: str(255),
		default: '',
		group: 'smtp'
	}),

	// E-Mail-Layout
	g({
		key: 'core.mail.layoutEnabled',
		schema: z.boolean(),
		default: true,
		group: 'mail'
	}),
	g({
		key: 'core.mail.showEmblem',
		schema: z.boolean(),
		default: true,
		group: 'mail'
	}),
	g({
		key: 'core.mail.signature',
		schema: str(400),
		default: '',
		group: 'mail'
	}),
	g({
		key: 'core.mail.footerText',
		schema: str(800),
		default: DEFAULT_MAIL_FOOTER,
		group: 'mail'
	}),

	// Storage
	g({
		key: 'core.storage.endpoint',
		schema: urlOrEmpty,
		default: '',
		group: 'storage'
	}),
	g({
		key: 'core.storage.region',
		schema: str(60),
		default: 'auto',
		group: 'storage'
	}),
	g({
		key: 'core.storage.bucket',
		schema: str(100),
		default: '',
		group: 'storage'
	}),
	g({
		key: 'core.storage.accessKeyId',
		schema: str(200),
		default: '',
		secret: true,
		group: 'storage'
	}),
	g({
		key: 'core.storage.secretAccessKey',
		schema: str(500),
		default: '',
		secret: true,
		group: 'storage'
	}),
	g({
		key: 'core.storage.forcePathStyle',
		schema: z.boolean(),
		default: false,
		group: 'storage'
	}),
	g({
		key: 'core.storage.maxFileSizeMb',
		schema: z.coerce.number().int().min(1).max(5000),
		default: 50,
		group: 'storage'
	}),
	g({
		key: 'core.storage.allowedContentTypes',
		schema: z.array(z.string().max(100)).max(100),
		default: [],
		group: 'storage'
	}),

	// KI
	g({
		key: 'core.ai.apiKey',
		schema: str(500),
		default: '',
		secret: true,
		group: 'ai'
	}),
	g({
		key: 'core.ai.baseUrl',
		schema: urlOrEmpty,
		default: '',
		group: 'ai'
	}),
	g({
		key: 'core.ai.defaultModel',
		schema: str(100).min(1),
		default: 'gpt-4o-mini',
		group: 'ai'
	}),
	g({
		key: 'core.ai.allowedModels',
		schema: z.array(str(100)).max(50),
		default: [],
		group: 'ai'
	}),
	g({
		key: 'core.ai.allowedModules',
		schema: z.array(str(40)).max(100),
		default: [],
		group: 'ai'
	}),
	g({
		key: 'core.ai.monthlyTokenLimit',
		schema: z.coerce.number().int().min(0),
		default: 0,
		group: 'ai'
	}),
	g({
		key: 'core.ai.monthlyCostLimitUsd',
		schema: z.coerce.number().min(0),
		default: 0,
		group: 'ai'
	}),
	g({
		key: 'core.ai.requestsPerMinute',
		schema: z.coerce.number().int().min(1).max(10000),
		default: 60,
		group: 'ai'
	}),
	g({
		key: 'core.ai.pricing',
		schema: z.record(z.string(), z.object({ input: z.number().min(0), output: z.number().min(0) })),
		default: {},
		group: 'ai'
	}),
	g({
		key: 'core.ai.userMonthlyTokenLimit',
		schema: z.coerce.number().int().min(0),
		default: 200_000,
		group: 'ai'
	}),
	g({
		key: 'core.ai.style.address',
		schema: z.enum(['du', 'ihr', 'Sie']),
		default: 'du',
		group: 'ai'
	}),
	g({
		key: 'core.ai.style.tone',
		schema: str(300),
		default: 'freundlich und klar',
		group: 'ai'
	}),
	g({
		key: 'core.ai.style.greeting',
		schema: str(100),
		default: 'Viele Grüße',
		group: 'ai'
	}),
	g({
		key: 'core.ai.style.context',
		schema: str(400),
		default: '',
		group: 'ai'
	}),
	g({
		key: 'core.ai.style.notes',
		schema: str(1000),
		default: '',
		group: 'ai'
	}),
	g({
		key: 'core.ai.assist.allowInbox',
		schema: z.boolean(),
		default: false,
		group: 'ai'
	}),
	g({
		key: 'core.ai.assist.allowImages',
		schema: z.boolean(),
		default: false,
		group: 'ai'
	}),

	// PDF
	g({
		key: 'core.pdf.defaultFormat',
		schema: z.enum(['A3', 'A4', 'A5', 'Letter', 'Legal']),
		default: 'A4',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.defaultOrientation',
		schema: z.enum(['portrait', 'landscape']),
		default: 'portrait',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.marginTop',
		schema: cssLength,
		default: '25mm',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.marginRight',
		schema: cssLength,
		default: '18mm',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.marginBottom',
		schema: cssLength,
		default: '22mm',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.marginLeft',
		schema: cssLength,
		default: '18mm',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.headerText',
		schema: str(200),
		default: '',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.footerText',
		schema: str(200),
		default: '',
		group: 'pdf'
	}),
	g({
		key: 'core.pdf.showLogo',
		schema: z.boolean(),
		default: true,
		group: 'pdf'
	}),

	// Benachrichtigungen / Web Push (core.notifications)
	g({
		key: 'core.push.enabled',
		schema: z.boolean(),
		default: true,
		group: 'push'
	}),
	g({
		key: 'core.push.vapidPublicKey',
		schema: z.union([z.literal(''), z.string().regex(/^[A-Za-z0-9_-]{80,100}$/)]),
		default: '',
		group: 'push'
	}),
	g({
		key: 'core.push.vapidPrivateKey',
		schema: z.union([z.literal(''), z.string().regex(/^[A-Za-z0-9_-]{40,50}$/)]),
		default: '',
		secret: true,
		group: 'push'
	}),

	// Benutzer
	g({
		key: 'core.user.theme',
		schema: z.enum(['light', 'dark', 'system']),
		default: 'system',
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.locale',
		schema: z.enum(['', 'de', 'en']),
		default: '',
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.accentColor',
		schema: z.union([z.literal(''), hexColor]),
		default: '',
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.themes',
		schema: userThemesSchema,
		default: [],
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.activeTheme',
		schema: activeThemeSchema,
		default: '',
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.themeFavorites',
		schema: themeFavoritesSchema,
		default: [],
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.density',
		schema: z.enum(['comfortable', 'compact']),
		default: 'comfortable',
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.startPage',
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
		schema: z.coerce.number().int().min(10).max(200),
		default: 25,
		scope: 'user',
		group: 'user'
	}),
	g({
		key: 'core.user.dashboard',
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
