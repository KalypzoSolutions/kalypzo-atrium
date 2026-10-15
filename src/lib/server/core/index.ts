/**
 * Zentrales Core-SDK (nur Server). Module importieren ausschliesslich `$lib/sdk/server`.
 * Jede Operation arbeitet mit einem RequestContext; Berechtigungen werden hier erzwungen.
 */
import * as ai from './ai';
import { createApiKey, listApiKeys, revokeApiKey } from './api/keys';
import { defineEndpoint } from './api/registry';
import { auditFromContext, listAudit, logAudit } from './audit/service';
import { getAuth } from './auth';
import {
	anonymousContext,
	contextForUser,
	resolveApiKey,
	resolveSession,
	systemContext
} from './auth/context';
import { searchUserDirectory } from './auth/users';
import { decryptSecret, encryptSecret, isEncrypted } from './crypto';
import { getDb } from './database/client';
import { forModule, transaction } from './database/module-db';
import { allDefinitions } from './modules/registry';
import {
	assertModuleEnabled,
	disableModule,
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
import * as pdf from './pdf';
import { sendMail } from './mail';
import { errors } from './errors';
import { getPublicSettings, getSetting, getSettings, setSetting } from './settings/service';
import * as storage from './storage';

const EMAIL_RE = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]+$/;

/** Mailversand fuer Module mit Eingabevalidierung (Header-Injection, Laengen). */
async function sendModuleMail(msg: {
	to: string;
	subject: string;
	text: string;
	html?: string;
}): Promise<void> {
	if (typeof msg.to !== 'string' || msg.to.length > 254 || !EMAIL_RE.test(msg.to)) {
		throw errors.validation([{ path: ['to'], message: 'Ungueltige E-Mail-Adresse' }]);
	}
	if (
		typeof msg.subject !== 'string' ||
		!msg.subject.trim() ||
		msg.subject.length > 200 ||
		/[\r\n]/.test(msg.subject)
	) {
		throw errors.validation([
			{ path: ['subject'], message: 'Betreff ungueltig (max. 200 Zeichen, keine Zeilenumbrueche)' }
		]);
	}
	if (typeof msg.text !== 'string' || msg.text.length > 20000) {
		throw errors.validation([{ path: ['text'], message: 'Text zu lang (max. 20000 Zeichen)' }]);
	}
	if (msg.html !== undefined && (typeof msg.html !== 'string' || msg.html.length > 100000)) {
		throw errors.validation([{ path: ['html'], message: 'HTML zu lang (max. 100000 Zeichen)' }]);
	}
	await sendMail(msg);
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
		 * Minimales Verzeichnis (id, name, email) aktiver Benutzer, z. B. fuer Freigaben.
		 * Braucht nur Anmeldung; Suche ab 2 Zeichen, maximal 30 Treffer.
		 */
		directory: searchUserDirectory
	},
	crypto: {
		/** Verschluesselung sensibler Modul-Daten (AES-256-GCM), Schluessel je Modul abgeleitet */
		forModule: (moduleId: string) => ({
			encrypt: (plain: string) => encryptSecret(plain, `module:${moduleId}`),
			decrypt: (value: string) => decryptSecret(value, `module:${moduleId}`),
			isEncrypted
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
		navigationFor,
		registered: () => allDefinitions().map((d) => d.manifest)
	},
	settings: {
		get: getSetting,
		getMany: getSettings,
		set: setSetting,
		/** Fuer Clients: Secrets werden nie ausgeliefert */
		listPublic: getPublicSettings
	},
	api: {
		defineEndpoint,
		keys: { create: createApiKey, list: listApiKeys, revoke: revokeApiKey }
	},
	database: {
		/** Core-interner Zugriff; Module verwenden `forModule(id)` */
		db: getDb,
		transaction,
		forModule
	},
	pdf: {
		generate: pdf.generate,
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
		remove: storage.remove,
		stat: storage.stat,
		list: storage.list,
		signedUploadUrl: storage.createSignedUploadUrl,
		confirmUpload: storage.confirmUpload,
		signedDownloadUrl: storage.createSignedDownloadUrl,
		usage: storage.usageByModule
	},
	mail: {
		/** Sendet eine E-Mail an eine einzelne Adresse; SMTP-Fehler werden weitergereicht */
		send: sendModuleMail
	},
	audit: { log: logAudit, logFromContext: auditFromContext, list: listAudit }
} as const;

export type Core = typeof core;
