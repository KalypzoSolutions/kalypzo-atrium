import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	hkdfSync,
	randomBytes,
	timingSafeEqual
} from 'node:crypto';
import { env } from './env';

const PREFIX = 'enc:v1:';

function key(purpose: string): Buffer {
	return Buffer.from(hkdfSync('sha256', env().APP_SECRET, 'ep-intern', purpose, 32));
}

/** AES-256-GCM. Format: enc:v1:<iv>.<tag>.<ciphertext> (base64url) */
export function encryptSecret(plain: string, purpose = 'settings'): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(purpose), iv);
	const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(value: string, purpose = 'settings'): string {
	if (!value.startsWith(PREFIX)) throw new Error('Kein verschlüsselter Wert');
	const [iv, tag, data] = value.slice(PREFIX.length).split('.');
	if (!iv || !tag || !data) throw new Error('Beschädigter Wert');
	const decipher = createDecipheriv('aes-256-gcm', key(purpose), Buffer.from(iv, 'base64url'));
	decipher.setAuthTag(Buffer.from(tag, 'base64url'));
	return Buffer.concat([
		decipher.update(Buffer.from(data, 'base64url')),
		decipher.final()
	]).toString('utf8');
}

export function isEncrypted(value: unknown): value is string {
	return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Deterministischer, schlüsselgebundener Hash (HMAC-SHA256) – z. B. zum Wiederfinden einer IBAN ohne Klartext */
export function keyedHash(input: string, purpose: string): string {
	return createHmac('sha256', key(`hash:${purpose}`))
		.update(input)
		.digest('hex');
}

export function sha256(input: string): string {
	return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
	const ba = Buffer.from(a);
	const bb = Buffer.from(b);
	return ba.length === bb.length && timingSafeEqual(ba, bb);
}
