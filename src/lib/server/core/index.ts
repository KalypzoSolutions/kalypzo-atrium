/**
 * Zentrales Core-SDK (nur Server). Module importieren ausschließlich `$lib/sdk/server`.
 * Jede Operation arbeitet mit einem RequestContext; Berechtigungen werden hier erzwungen.
 */
import * as ai from './ai';
import { createApiKey, listApiKeys, revokeApiKey } from './api/keys';
import { defineEndpoint } from './api/registry';
import { auditFromContext, listAuditByTargets, listModuleAudit, logAudit } from './audit/service';
import { getAuth } from './auth';
import {
	anonymousContext,
	contextForUser,
	resolveApiKey,
	resolveSession,
	systemContext
} from './auth/context';
import { registerUserWithRole, searchUserDirectory, usersByIds } from './auth/users';
import { decryptSecret, encryptSecret, isEncrypted, keyedHash } from './crypto';
import { forModule } from './database/module-db';
import { findDefaultRoleId } from './permissions/default-roles';
import { allDefinitions } from './modules/registry';
import { notifyMembersDeleted } from './privacy/member-hooks';
import {
	assertModuleEnabled,
	disableModule,
	useModuleService,
	useOptionalModuleService,
	enableModule,
	isModuleEnabled,
	listModules,
	navigationFor
} from './modules/service';
import {
	assertCanGrant,
	getUserPermissions,
	has,
	hasAny,
	listPermissions,
	requireAny,
	requirePermission
} from './permissions/service';
import { roleDirectory, roleIdsForUser } from './permissions/roles';
import {
	assertCanGrantRoles,
	listModuleRoleGrants,
	replaceModuleRoleGrants
} from './permissions/grants';
import { readAvatar } from './auth/profile';
import * as pdf from './pdf';
import { sendMail } from './mail';
import { errors } from './errors';
import { env } from './env';
import { qrDataUrl } from './qr';
import {
	listPublicSettingsFor,
	getSetting,
	getSettings,
	setSetting,
	setSettings
} from './settings/service';
import * as storage from './storage';
import { processImage } from './images';
import {
	RESET_CONFIRM_WORD,
	executeReset,
	exportResetData,
	listResetAreas,
	previewReset
} from './system/reset';

const EMAIL_RE = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]+$/;

const MAX_MAIL_FILES = 3;
const MAX_MAIL_FILE_BYTES = 5 * 1024 * 1024;

/** Mailversand für Module mit Eingabevalidierung (Header-Injection, Längen, nur PDF-Anhänge). */
async function sendModuleMail(msg: {
	to: string;
	subject: string;
	text: string;
	html?: string;
	/** Nur PDF, höchstens 3 Dateien und 5 MB gesamt */
	attachments?: { filename: string; contentType: 'application/pdf'; data: Uint8Array }[];
}): Promise<void> {
	if (typeof msg.to !== 'string' || msg.to.length > 254 || !EMAIL_RE.test(msg.to)) {
		throw errors.validation([{ path: ['to'], message: 'Ungültige E-Mail-Adresse' }]);
	}
	if (
		typeof msg.subject !== 'string' ||
		!msg.subject.trim() ||
		msg.subject.length > 200 ||
		/[\r\n]/.test(msg.subject)
	) {
		throw errors.validation([
			{ path: ['subject'], message: 'Betreff ungültig (max. 200 Zeichen, keine Zeilenumbrüche)' }
		]);
	}
	if (typeof msg.text !== 'string' || msg.text.length > 20000) {
		throw errors.validation([{ path: ['text'], message: 'Text zu lang (max. 20000 Zeichen)' }]);
	}
	if (msg.html !== undefined && (typeof msg.html !== 'string' || msg.html.length > 100000)) {
		throw errors.validation([{ path: ['html'], message: 'HTML zu lang (max. 100000 Zeichen)' }]);
	}
	const list = msg.attachments ?? [];
	const total = list.reduce((s, a) => s + (a.data?.byteLength ?? 0), 0);
	if (
		list.length > MAX_MAIL_FILES ||
		total > MAX_MAIL_FILE_BYTES ||
		list.some((a) => a.contentType !== 'application/pdf' || !(a.data instanceof Uint8Array))
	) {
		throw errors.validation([
			{ path: ['attachments'], message: 'Nur bis zu 3 PDF-Anhänge mit zusammen max. 5 MB' }
		]);
	}
	const files = list.map((a) => ({
		filename:
			a.filename
				.normalize('NFKD')
				.replace(/[^A-Za-z0-9._-]+/g, '_')
				.replace(/^[._]+/, '')
				.slice(-100) || 'dokument.pdf',
		contentType: 'application/pdf',
		content: Buffer.from(a.data)
	}));
	const { attachments: _a, ...rest } = msg;
	void _a;
	await sendMail({ ...rest, files });
}

const MESSAGE_MAX_FILES = 10;
const MESSAGE_MAX_BYTES = 20 * 1024 * 1024;
/** Ausführbare/Skript-Dateien werden von vielen Mailservern abgelehnt und sind ein Missbrauchsweg */
const BLOCKED_ATTACHMENT =
	/\.(exe|bat|cmd|com|scr|msi|js|jse|vbs|vbe|wsf|ps1|jar|lnk|dll|apk|app|sh)$/i;

/**
 * Nachricht mit frei wählbarem (vom Modul bereits geprüftem) Absender, Antwortadresse und beliebigen
 * Anhängen (≤ 10 Dateien, zusammen ≤ 20 MB, keine ausführbaren Dateien). Gleiche Prüfungen wie `send`
 * für Empfänger, Betreff und Text.
 */
async function sendModuleMessage(msg: {
	to: string;
	subject: string;
	text: string;
	html?: string;
	from?: string;
	fromName?: string;
	replyTo?: string;
	attachments?: { filename: string; contentType: string; data: Uint8Array }[];
}): Promise<void> {
	const bad = (path: string, message: string) => errors.validation([{ path: [path], message }]);
	if (typeof msg.to !== 'string' || msg.to.length > 254 || !EMAIL_RE.test(msg.to)) {
		throw bad('to', 'Ungültige E-Mail-Adresse');
	}
	if (
		typeof msg.subject !== 'string' ||
		!msg.subject.trim() ||
		msg.subject.length > 200 ||
		/[\r\n]/.test(msg.subject)
	) {
		throw bad('subject', 'Betreff ungültig (max. 200 Zeichen, keine Zeilenumbrüche)');
	}
	if (typeof msg.text !== 'string' || msg.text.length > 200_000) {
		throw bad('text', 'Text zu lang');
	}
	if (msg.html !== undefined && (typeof msg.html !== 'string' || msg.html.length > 500_000)) {
		throw bad('html', 'HTML zu lang');
	}
	for (const [k, v] of [
		['from', msg.from],
		['replyTo', msg.replyTo]
	] as const) {
		if (v !== undefined && (typeof v !== 'string' || v.length > 254 || !EMAIL_RE.test(v))) {
			throw bad(k, 'Ungültige E-Mail-Adresse');
		}
	}
	const list = msg.attachments ?? [];
	const total = list.reduce((sum, a) => sum + (a.data?.byteLength ?? 0), 0);
	if (
		list.length > MESSAGE_MAX_FILES ||
		total > MESSAGE_MAX_BYTES ||
		list.some((a) => !(a.data instanceof Uint8Array) || BLOCKED_ATTACHMENT.test(a.filename))
	) {
		throw bad(
			'attachments',
			'Höchstens 10 Anhänge mit zusammen 20 MB; ausführbare Dateien sind nicht erlaubt'
		);
	}
	const files = list.map((a) => ({
		filename:
			a.filename
				.normalize('NFKD')
				.replace(/[^A-Za-z0-9._-]+/g, '_')
				.replace(/^[._]+/, '')
				.slice(-100) || 'anhang',
		contentType: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(a.contentType)
			? a.contentType
			: 'application/octet-stream',
		content: Buffer.from(a.data)
	}));
	const { attachments: _a, ...rest } = msg;
	void _a;
	await sendMail({ ...rest, files });
}

export const core = {
	auth: {
		/** Better-Auth-Instanz (serverseitig) */
		instance: getAuth,
		resolveSession,
		resolveApiKey,
		contextForUser,
		systemContext,
		anonymousContext
	},
	users: {
		/**
		 * Minimales Verzeichnis (id, name, email) aktiver Benutzer, z. B. für Freigaben.
		 * Braucht nur Anmeldung; Suche ab 2 Zeichen, maximal 30 Treffer.
		 */
		directory: searchUserDirectory,
		/**
		 * Benutzer*innen zu IDs als Map (stückelt intern, gleiche Regeln wie `directory`; unbekannte/deaktivierte
		 * fehlen). Statt eigener Schleifen um `directory` mit `ids` – Anzeige mit `userLabel(map, id)`.
		 */
		byIds: usersByIds,
		/**
		 * Legt ein Konto OHNE Rechteprüfung an (Rolle per Name, wird ohne Rechte angelegt). Nur aus
		 * kontrollierten öffentlichen Pfaden (z. B. gültiger Verknüpfungscode) aufrufen.
		 */
		registerWithRole: registerUserWithRole,
		/** Rollen-IDs eines Benutzers inkl. von Modulen verliehener (z. B. für Freigaben an Rollen) */
		roleIds: roleIdsForUser,
		/** Profilbild eines aktiven Benutzers (`null` ohne Bild/Storage), z. B. für Website-APIs */
		readAvatar
	},
	roles: {
		/**
		 * Minimales Rollenverzeichnis (id, name), z. B. für Freigaben an Rollen.
		 * Braucht nur Anmeldung (kein `core.roles.view`); Suche ab 2 Zeichen oder IDs, maximal 30 Treffer.
		 */
		directory: roleDirectory,
		/**
		 * Ersetzt alle Rollen, die das Modul Benutzer*innen verleiht (z. B. über Ämter). Wirksam nur bei
		 * aktivem Modul; manuelle Rollen bleiben unberührt. Keine Rechteprüfung – vorher `assertCanGrant`.
		 * Nicht innerhalb einer Modul-Transaktion aufrufen.
		 */
		replaceModuleGrants: replaceModuleRoleGrants,
		listModuleGrants: listModuleRoleGrants,
		/** Wirft `forbidden`, wenn dem Kontext Rechte einer der Rollen fehlen (Rechteausweitung) */
		assertCanGrant: assertCanGrantRoles,
		/**
		 * ID der Standardrolle aus `defaultRoleGrants` (Kennung `default:<Name>`) oder `null` – statt Suche per
		 * Name, die eine gleichnamige fremde Rolle treffen könnte (#67, 01a-07)
		 */
		defaultRoleId: (name: string) => findDefaultRoleId(name)
	},
	crypto: {
		/** Verschlüsselung sensibler Modul-Daten (AES-256-GCM), Schlüssel je Modul abgeleitet */
		forModule: (moduleId: string) => ({
			encrypt: (plain: string) => encryptSecret(plain, `module:${moduleId}`),
			decrypt: (value: string) => decryptSecret(value, `module:${moduleId}`),
			isEncrypted,
			/** HMAC-SHA256 mit Modulschlüssel (gleiche Eingabe → gleicher Wert, nicht umkehrbar) */
			hash: (value: string) => keyedHash(value, `module:${moduleId}`)
		})
	},
	permissions: {
		/** Wirft `unauthenticated`/`forbidden` */
		require: requirePermission,
		requireAny,
		has,
		hasAny,
		assertCanGrant,
		forUser: getUserPermissions,
		list: listPermissions
	},
	modules: {
		list: listModules,
		isEnabled: isModuleEnabled,
		assertEnabled: assertModuleEnabled,
		enable: enableModule,
		disable: disableModule,
		/** Dienste eines Moduls nutzen, von dem das aufrufende Modul abhängt (siehe `ModuleDefinition.provides`) */
		use: useModuleService,
		/** Wie `use`, für `optionalDependencies`: `null`, wenn der Anbieter nicht aktiv ist */
		useOptional: useOptionalModuleService,
		/**
		 * Nur für `members`: gelöschte/anonymisierte Mitglieder melden → `onMemberDeleted` aller
		 * anderen aktiven Module (nie in einer offenen Transaktion aufrufen). Rückgabe = Module mit Fehler.
		 */
		memberDeleted: notifyMembersDeleted,
		navigationFor,
		registered: () => allDefinitions().map((d) => d.manifest)
	},
	settings: {
		get: getSetting,
		getMany: getSettings,
		set: setSetting,
		/** Mehrere Werte atomar (alle geprüft, eine Transaktion) */
		setMany: setSettings,
		/** Alle nicht geheimen Werte – nur mit `core.settings.view` (#67, 01a-12); Secrets nie */
		listPublic: listPublicSettingsFor
	},
	api: {
		defineEndpoint,
		keys: { create: createApiKey, list: listApiKeys, revoke: revokeApiKey }
	},
	database: {
		/**
		 * Nur Modul-Transaktionen mit Schema-Isolation. `db`/`transaction` (ohne `search_path`) sind
		 * bewusst nicht mehr Teil des SDK (#67, 01a-12); Core-Code nutzt `database/client` direkt.
		 */
		forModule
	},
	pdf: {
		generate: pdf.generate,
		/** Mehrere Dokumente (z. B. Serienbrief mit je eigener Adresse) zu einem PDF zusammenführen */
		generateMany: pdf.generateMany,
		merge: pdf.mergePdfs,
		registerTemplate: pdf.registerTemplate,
		listTemplates: pdf.listTemplates
	},
	ai: {
		generate: ai.generate,
		generateJson: ai.generateJson,
		stream: ai.stream,
		usage: ai.usageSummary
	},
	storage: {
		upload: storage.upload,
		download: storage.download,
		/** Wie `download`, aber als Stream (Objekt nicht komplett im Speicher) */
		downloadStream: storage.downloadStream,
		remove: storage.remove,
		/** Viele Dateien auf einmal löschen (S3 DeleteObjects, ein Sammel-Audit) */
		removeMany: storage.removeMany,
		stat: storage.stat,
		list: storage.list,
		signedUploadUrl: storage.createSignedUploadUrl,
		confirmUpload: storage.confirmUpload,
		signedDownloadUrl: storage.createSignedDownloadUrl,
		usage: storage.usageByModule,
		/** Alle Dateien eines Moduls (optional Präfix) löschen; System oder `core.storage.manage` */
		purge: storage.purge
	},
	images: {
		/** Bild prüfen, nach EXIF drehen, Metadaten entfernen, Varianten erzeugen (sharp) */
		process: processImage
	},
	mail: {
		/** Sendet eine E-Mail an eine einzelne Adresse; SMTP-Fehler werden weitergereicht */
		send: sendModuleMail,
		/** Wie `send`, aber mit gewähltem Absender/Antwortadresse und bis zu 10 beliebigen Anhängen (20 MB) */
		sendMessage: sendModuleMessage
	},
	qr: {
		/** QR-Code als PNG-`data:`-URL (z. B. für den PDF-Bildblock) */
		dataUrl: qrDataUrl
	},
	app: {
		/** Öffentliche Basis-URL der Anwendung (`ORIGIN`, ohne abschließenden Schrägstrich) */
		origin: () => env().ORIGIN.replace(/\/+$/, '')
	},
	audit: {
		log: logAudit,
		logFromContext: auditFromContext,
		/** Einträge eines Moduls zu bekannten Objekten (Kontext, Modulpräfix, `targets` Pflicht) */
		listForModule: listModuleAudit,
		/** @deprecated `listForModule` verwenden – verlangt bereits `targets` (kein Gesamt-Log) */
		list: listAuditByTargets
	},
	system: {
		/** Admin-Reset (Recht `core.system.reset`, nur Session-Benutzer); siehe `system/reset.ts` */
		reset: {
			listAreas: listResetAreas,
			preview: previewReset,
			export: exportResetData,
			execute: executeReset,
			confirmWord: RESET_CONFIRM_WORD
		}
	}
} as const;

export type Core = typeof core;
