import nodemailer, { type Transporter } from 'nodemailer';
import { errors } from './errors';
import { invalidateMailTransportCache, mailTransportGeneration } from './mail-cache';
import { loadMailLayoutOptions, renderMailLayout, type MailAttachment } from './mail-layout';
import { getSettings } from './settings/service';

export interface MailMessage {
	to: string;
	subject: string;
	text: string;
	/** HTML-Fragment (Inhalt); ohne Angabe wird es aus `text` erzeugt */
	html?: string;
	/** `false`: ohne Stamm-Layout senden (Standard: Layout aus den Einstellungen) */
	layout?: boolean;
	/** Dateianhänge (z. B. Rechnung als PDF) */
	files?: { filename: string; contentType: string; content: Buffer }[];
	/**
	 * Abweichende Absenderadresse (Standard: `core.smtp.from`). Nur für Module, die den Absender vorher
	 * geprüft haben (z. B. `messages`); der SMTP-Server muss das Senden als diese Adresse erlauben.
	 */
	from?: string;
	/** Anzeigename zur Absenderadresse (ohne Zeilenumbrüche/Anführungszeichen) */
	fromName?: string;
	/** Adresse für Antworten */
	replyTo?: string;
	/**
	 * Zusätzliche Kopfzeilen (z. B. `List-Unsubscribe`); nur vom Core gesetzt (`core.mail.sendMessage`),
	 * Werte ohne Zeilenumbrüche.
	 */
	headers?: Record<string, string>;
}

export interface MailTransport {
	sendMail(msg: {
		from: string;
		to: string;
		subject: string;
		text: string;
		html?: string;
		replyTo?: string;
		/** `Message-ID` mit der Domain des Absenders (statt des SMTP-Hosts) */
		messageId?: string;
		headers?: Record<string, string>;
		attachments?: (MailAttachment | { filename: string; content: Buffer; contentType: string })[];
	}): Promise<unknown>;
}

let testTransport: MailTransport | undefined;
/** Für Tests: ersetzt SMTP durch einen Testadapter. */
export function setMailTransportForTests(t: MailTransport | undefined): void {
	testTransport = t;
}

/**
 * Zeitgrenzen für SMTP (#24): Verbindungsaufbau, Begrüßung und Funkstille je Verbindung sowie eine
 * Obergrenze je Mail, damit ein hängender Mailserver keinen Request (z. B. öffentliche Anmeldung)
 * länger als ~25 s blockiert.
 */
export const SMTP_TIMEOUTS = {
	connectionTimeout: 10_000,
	greetingTimeout: 10_000,
	socketTimeout: 20_000,
	sendTimeout: 25_000
} as const;
let timeoutOverride: Partial<Record<keyof typeof SMTP_TIMEOUTS, number>> = {};
/** Für Tests: kürzere Zeitgrenzen (leeres Objekt = Standard). Verwirft den Transport-Cache. */
export function setSmtpTimeoutsForTests(t: Partial<Record<keyof typeof SMTP_TIMEOUTS, number>>) {
	timeoutOverride = t;
	invalidateMailTransportCache();
}
const timeouts = () => ({ ...SMTP_TIMEOUTS, ...timeoutOverride });

const SMTP_KEYS = [
	'core.smtp.host',
	'core.smtp.port',
	'core.smtp.secure',
	'core.smtp.user',
	'core.smtp.password',
	'core.smtp.from'
] as const;

/**
 * Einstellungen und Transport werden zwischengespeichert (#24): Speichern über `setSettings`
 * invalidiert sofort (`invalidateMailTransportCache`), direkte DB-Änderungen (Wiederherstellung,
 * Zurücksetzen) wirken spätestens nach der TTL. Der Transport ist gepoolt (`pool: true`) und
 * wird nur neu aufgebaut, wenn sich die Verbindungsdaten ändern.
 */
const SETTINGS_TTL_MS = 10_000;
let settingsCache:
	{ at: number; generation: number; promise: Promise<Record<string, unknown>> } | undefined;
let transportCache: { key: string; t: Transporter } | undefined;

async function smtpSettings(): Promise<Record<string, unknown>> {
	const generation = mailTransportGeneration();
	if (
		settingsCache &&
		settingsCache.generation === generation &&
		Date.now() - settingsCache.at < SETTINGS_TTL_MS
	) {
		return settingsCache.promise;
	}
	const promise = getSettings([...SMTP_KEYS]);
	settingsCache = { at: Date.now(), generation, promise };
	promise.catch(() => {
		if (settingsCache?.promise === promise) settingsCache = undefined;
	});
	return promise;
}

function closeTransport(): void {
	const old = transportCache;
	transportCache = undefined;
	try {
		old?.t.close();
	} catch {
		// Schließen ist best effort
	}
}

function pooledTransport(s: Record<string, unknown>): Transporter {
	const options = { ...smtpTransportOptions(s), ...poolOptions() };
	const key = JSON.stringify([mailTransportGeneration(), options]);
	if (transportCache?.key === key) return transportCache.t;
	closeTransport();
	const t = nodemailer.createTransport(options);
	transportCache = { key, t };
	return t;
}

function poolOptions() {
	const { connectionTimeout, greetingTimeout, socketTimeout } = timeouts();
	return {
		pool: true as const,
		maxConnections: 3,
		maxMessages: 100,
		connectionTimeout,
		greetingTimeout,
		socketTimeout
	};
}

async function transport(): Promise<{ t: MailTransport; from: string; pooled: boolean }> {
	const s = await smtpSettings();
	const from = String(s['core.smtp.from'] || '');
	// Benutzer ohne Passwort: z. B. nach Host-Wechsel verworfen (#15) – nicht ohne Anmeldung versuchen
	if (s['core.smtp.user'] && !s['core.smtp.password']) {
		throw errors.unavailable('SMTP ist nicht konfiguriert (Passwort fehlt)');
	}
	if (testTransport)
		return { t: testTransport, from: from || 'test@example.invalid', pooled: false };
	const host = String(s['core.smtp.host'] || '');
	if (!host || !from) throw errors.unavailable('SMTP ist nicht konfiguriert');
	return { t: pooledTransport(s), from, pooled: true };
}

/** Fehlercodes von nodemailer, nach denen der Pool neu aufgebaut wird (nicht bei abgelehnten Empfängern) */
const CONNECTION_ERRORS = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'EAUTH', 'ETLS']);

/** Versand mit Obergrenze; bei Zeitüberschreitung wird der (evtl. hängende) Pool verworfen. */
async function deliver(
	t: MailTransport,
	pooled: boolean,
	msg: Parameters<MailTransport['sendMail']>[0]
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			if (pooled) closeTransport();
			reject(errors.unavailable('Der Mailserver antwortet nicht (Zeitüberschreitung)'));
		}, timeouts().sendTimeout);
	});
	try {
		await Promise.race([t.sendMail(msg), limit]);
	} catch (e) {
		// Verbindungsfehler: Pool neu aufbauen, damit die nächste Mail frisch verbindet
		if (pooled && CONNECTION_ERRORS.has(String((e as { code?: unknown })?.code))) closeTransport();
		throw e;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Nodemailer-Optionen aus den SMTP-Einstellungen. Port 465 heißt immer TLS direkt (`secure`); mit
 * Anmeldung ist TLS Pflicht (`requireTLS` → STARTTLS, sonst Abbruch), damit Zugangsdaten nie im
 * Klartext übertragen werden. Ohne Anmeldung (z. B. lokales Relay) bleibt STARTTLS optional.
 */
export function smtpTransportOptions(s: Record<string, unknown>) {
	const port = Number(s['core.smtp.port']);
	const user = String(s['core.smtp.user'] || '');
	const secure = Boolean(s['core.smtp.secure']) || port === 465;
	return {
		host: String(s['core.smtp.host'] || ''),
		port,
		secure,
		requireTLS: !secure && !!user,
		auth: user ? { user, pass: String(s['core.smtp.password'] || '') } : undefined
	};
}

export { invalidateMailTransportCache } from './mail-cache';

/** Laufende `sendMail`-Aufrufe (auch „fire and forget“), für `mailIdleForTests` */
const pendingSends = new Set<Promise<void>>();

/**
 * Für Tests (#75): wartet, bis alle laufenden `sendMail`-Aufrufe abgeschlossen sind – statt einer
 * festen Wartezeit nach Vorgängen, die Mails ohne `await` verschicken. Fehler werden ignoriert.
 */
export async function mailIdleForTests(): Promise<void> {
	while (pendingSends.size > 0) await Promise.allSettled([...pendingSends]);
}

export function sendMail(msg: MailMessage): Promise<void> {
	const p = sendMailNow(msg);
	pendingSends.add(p);
	p.then(
		() => pendingSends.delete(p),
		() => pendingSends.delete(p)
	);
	return p;
}

/**
 * HTML einer Mail, wie sie beim Versand aussähe (Stamm-Layout mit den gespeicherten Einstellungen,
 * Bilder als `data:`-URLs statt CID) – für Vorschauen, ohne etwas zu senden.
 */
export async function previewMailHtml(msg: {
	text: string;
	html: string;
	layout?: boolean;
}): Promise<string> {
	const options = await loadMailLayoutOptions();
	if (msg.layout === false || !options.enabled) return msg.html;
	return renderMailLayout({ text: msg.text, html: msg.html }, options, 'data').html;
}

const SENDER_ADDRESS = /^[^\s@,;<>()"\x5c]+@[^\s@,;<>()"\x5c]+\.[^\s@,;<>()"\x5c]+$/;

/** Absender-Kopfzeile `"Name" <adresse>`; ungültige Adressen/Namen mit Steuerzeichen werden abgewiesen (Header-Injection). */
export function formatSender(address: string, name?: string): string {
	if (address.length > 254 || !SENDER_ADDRESS.test(address)) {
		throw errors.badRequest('Ungültige Absenderadresse');
	}
	const clean = (name ?? '')
		// Steuerzeichen (Zeilenumbrüche!) und Anführungszeichen/Klammern entfernen
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f"<>\x5c]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 100);
	return clean ? `"${clean}" <${address}>` : address;
}

async function sendMailNow(msg: MailMessage): Promise<void> {
	const { t, from: defaultFrom, pooled } = await transport();
	const { layout, files = [], from: fromAddress, fromName, replyTo, headers, ...mail } = msg;
	const from = fromAddress ? formatSender(fromAddress, fromName) : defaultFrom;
	if (replyTo !== undefined && (replyTo.length > 254 || !SENDER_ADDRESS.test(replyTo))) {
		throw errors.badRequest('Ungültige Antwortadresse');
	}
	const reply = replyTo ? { replyTo } : {};
	// Message-ID mit der Domain der Absenderadresse (passt zu SPF/DKIM, weniger Spam-Punkte)
	const domain = fromAddress?.split('@')[1];
	const extra = {
		...(domain ? { messageId: `<${crypto.randomUUID()}@${domain}>` } : {}),
		...(headers && Object.keys(headers).length ? { headers } : {})
	};
	const options = await loadMailLayoutOptions();
	if (layout === false || !options.enabled) {
		await deliver(t, pooled, {
			from,
			...mail,
			...reply,
			...extra,
			...(files.length ? { attachments: files } : {})
		});
		return;
	}
	const rendered = renderMailLayout(mail, options);
	await deliver(t, pooled, {
		from,
		to: mail.to,
		subject: mail.subject,
		...reply,
		...extra,
		...rendered,
		attachments: [...rendered.attachments, ...files]
	});
}
