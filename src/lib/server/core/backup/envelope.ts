/**
 * Datensicherung – verschlüsselte Hülle der `.epbackup`-Datei.
 *
 * Aufbau (alle Zahlen Big Endian):
 *   Header (34 Byte, zugleich AAD jedes Chunks):
 *     'EPBK' (4) | Version u8 (= 1) | scrypt N u32 | r u8 | p u8 | Salt (16) | Nonce-Präfix (7)
 *   Chunks, je: [Länge u32][Ciphertext][GCM-Tag 16]
 *     Klartext ≤ `BACKUP_LIMITS.envelopeChunkBytes`, AES-256-GCM,
 *     Nonce (12) = Präfix (7) ‖ Zähler u32 ‖ Final-Flag u8 (0/1).
 *   Der letzte Chunk trägt Final = 1 (auch wenn er leer ist); danach darf nichts mehr folgen.
 *
 * Dadurch werden Abschneiden (Final fehlt), Anhängen, Vertauschen und Verändern erkannt. Klartext wird
 * erst nach erfolgreicher Tag-Prüfung eines Chunks herausgegeben. Schlüssel: scrypt(Passwort NFC, Salt, 32).
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { open } from 'node:fs/promises';
import { ByteReader, fileSource } from './io';
import {
	BACKUP_LIMITS,
	BackupFormatError,
	type ByteSink,
	type ByteSource,
	type EnvelopeHeader
} from './types';
import { t } from '$lib/i18n';

const MAGIC = [0x45, 0x50, 0x42, 0x4b]; // 'EPBK'
const VERSION = 1;
const SALT_BYTES = 16;
const PREFIX_BYTES = 7;
const TAG_BYTES = 16;
export const ENVELOPE_HEADER_BYTES = 4 + 1 + 4 + 1 + 1 + SALT_BYTES + PREFIX_BYTES;

/** Standard beim Schreiben */
export const DEFAULT_SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;
/** Obergrenzen beim Lesen (Schutz vor Parametern, die Speicher/CPU sprengen) */
const MAX_N = 2 ** 20;
const MAX_R = 16;
const MAX_P = 4;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

// Texte erst beim Werfen übersetzen (Sprache des Requests)
const MSG_WRONG_PASSWORD = () => t('backup.format.wrongPassword');
const MSG_CORRUPT = () => t('backup.format.corrupt');
const MSG_NOT_BACKUP = () => t('backup.format.notBackup');
const MSG_UNSUPPORTED = () => t('backup.format.unsupported');

function validParams(N: number, r: number, p: number): boolean {
	return (
		Number.isInteger(N) &&
		Number.isInteger(r) &&
		Number.isInteger(p) &&
		N >= 2 &&
		N <= MAX_N &&
		(N & (N - 1)) === 0 &&
		r >= 1 &&
		r <= MAX_R &&
		p >= 1 &&
		p <= MAX_P &&
		// scrypt braucht etwa 128·N·r Byte – muss in `maxmem` passen
		128 * N * r < SCRYPT_MAXMEM
	);
}

function encodeHeader(
	params: { N: number; r: number; p: number },
	salt: Uint8Array,
	noncePrefix: Uint8Array
): Uint8Array {
	const raw = Buffer.alloc(ENVELOPE_HEADER_BYTES);
	raw.set(MAGIC, 0);
	raw.writeUInt8(VERSION, 4);
	raw.writeUInt32BE(params.N, 5);
	raw.writeUInt8(params.r, 9);
	raw.writeUInt8(params.p, 10);
	raw.set(salt, 11);
	raw.set(noncePrefix, 11 + SALT_BYTES);
	return raw;
}

/** Header aus den ersten Bytes lesen und prüfen */
export function parseEnvelopeHeader(bytes: Uint8Array): EnvelopeHeader {
	if (bytes.length < ENVELOPE_HEADER_BYTES || MAGIC.some((b, i) => bytes[i] !== b)) {
		throw new BackupFormatError('corrupt', MSG_NOT_BACKUP());
	}
	const buf = Buffer.from(bytes.buffer, bytes.byteOffset, ENVELOPE_HEADER_BYTES);
	if (buf.readUInt8(4) !== VERSION) {
		throw new BackupFormatError('unsupported', t('backup.format.versionUnsupported'));
	}
	const N = buf.readUInt32BE(5);
	const r = buf.readUInt8(9);
	const p = buf.readUInt8(10);
	if (!validParams(N, r, p)) throw new BackupFormatError('unsupported', MSG_UNSUPPORTED());
	const raw = new Uint8Array(buf.subarray(0, ENVELOPE_HEADER_BYTES));
	return {
		version: 1,
		params: { N, r, p },
		salt: raw.slice(11, 11 + SALT_BYTES),
		noncePrefix: raw.slice(11 + SALT_BYTES, ENVELOPE_HEADER_BYTES),
		raw
	};
}

export async function readEnvelopeHeader(path: string): Promise<EnvelopeHeader> {
	const fh = await open(path, 'r');
	try {
		const buf = Buffer.alloc(ENVELOPE_HEADER_BYTES);
		const { bytesRead } = await fh.read(buf, 0, ENVELOPE_HEADER_BYTES, 0);
		return parseEnvelopeHeader(buf.subarray(0, bytesRead));
	} finally {
		await fh.close();
	}
}

function scryptAsync(
	password: string,
	salt: Uint8Array,
	params: { N: number; r: number; p: number }
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(
			password.normalize('NFC'),
			salt,
			32,
			{ N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM },
			(err, key) => (err ? reject(err) : resolve(key))
		);
	});
}

export async function deriveEnvelopeKey(header: EnvelopeHeader, password: string): Promise<Buffer> {
	const { N, r, p } = header.params;
	if (!validParams(N, r, p)) throw new BackupFormatError('unsupported', MSG_UNSUPPORTED());
	try {
		return await scryptAsync(password, header.salt, header.params);
	} catch {
		throw new BackupFormatError('unsupported', MSG_UNSUPPORTED());
	}
}

function nonceFor(prefix: Uint8Array, counter: number, final: boolean): Buffer {
	const n = Buffer.alloc(12);
	n.set(prefix, 0);
	n.writeUInt32BE(counter, PREFIX_BYTES);
	n.writeUInt8(final ? 1 : 0, 11);
	return n;
}

/**
 * Verschlüsselnde Senke: puffert Klartext bis zur Chunkgröße. `close()` schreibt den Final-Chunk und
 * schließt die darunterliegende Senke. `chunkBytes` nur für Tests (kleiner als der Standard).
 */
export async function createEnvelopeWriter(
	sink: ByteSink,
	password: string,
	opts: { params?: { N: number; r: number; p: number }; chunkBytes?: number } = {}
): Promise<ByteSink> {
	const params = opts.params ?? DEFAULT_SCRYPT_PARAMS;
	if (!validParams(params.N, params.r, params.p)) {
		throw new BackupFormatError('unsupported', MSG_UNSUPPORTED());
	}
	const chunkBytes = Math.min(
		BACKUP_LIMITS.envelopeChunkBytes,
		Math.max(1, opts.chunkBytes ?? BACKUP_LIMITS.envelopeChunkBytes)
	);
	const salt = randomBytes(SALT_BYTES);
	const prefix = randomBytes(PREFIX_BYTES);
	const raw = encodeHeader(params, salt, prefix);
	const key = await scryptAsync(password, salt, params);
	await sink.write(raw);

	const pending = Buffer.alloc(chunkBytes);
	let filled = 0;
	let counter = 0;
	let closed = false;

	const seal = async (plain: Uint8Array, final: boolean) => {
		if (counter > 0xffffffff) throw new Error('Sicherung zu groß für das Hüllenformat');
		const cipher = createCipheriv('aes-256-gcm', key, nonceFor(prefix, counter, final), {
			authTagLength: TAG_BYTES
		});
		cipher.setAAD(raw);
		const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
		const frame = Buffer.alloc(4 + ct.length + TAG_BYTES);
		frame.writeUInt32BE(ct.length, 0);
		frame.set(ct, 4);
		frame.set(cipher.getAuthTag(), 4 + ct.length);
		counter++;
		await sink.write(frame);
	};

	return {
		async write(chunk) {
			if (closed) throw new Error('Hülle ist bereits geschlossen');
			let off = 0;
			while (off < chunk.length) {
				// Ein voller Puffer wird erst geschrieben, wenn weitere Bytes kommen – so kann der letzte
				// volle Chunk beim Schließen der Final-Chunk sein.
				if (filled === chunkBytes) {
					await seal(pending, false);
					filled = 0;
				}
				const k = Math.min(chunkBytes - filled, chunk.length - off);
				pending.set(chunk.subarray(off, off + k), filled);
				filled += k;
				off += k;
			}
		},
		async close() {
			if (closed) return;
			closed = true;
			await seal(pending.subarray(0, filled), true);
			pending.fill(0);
			key.fill(0);
			await sink.close();
		}
	};
}

function tryOpen(
	key: Buffer,
	header: EnvelopeHeader,
	counter: number,
	final: boolean,
	ct: Uint8Array,
	tag: Uint8Array
): Buffer | null {
	try {
		const d = createDecipheriv('aes-256-gcm', key, nonceFor(header.noncePrefix, counter, final), {
			authTagLength: TAG_BYTES
		});
		d.setAAD(header.raw);
		d.setAuthTag(tag);
		return Buffer.concat([d.update(ct), d.final()]);
	} catch {
		return null;
	}
}

/** Entschlüsselt die Datei streamend (Chunk für Chunk, nie die ganze Datei im Speicher). */
export function decryptEnvelope(path: string, header: EnvelopeHeader, key: Buffer): ByteSource {
	return {
		async *[Symbol.asyncIterator]() {
			const reader = new ByteReader(
				fileSource(path, { start: header.raw.length, chunkBytes: BACKUP_LIMITS.envelopeChunkBytes })
			);
			try {
				for (let counter = 0; ; counter++) {
					const lenBytes = await reader.readUpTo(4);
					// Ende ohne Final-Chunk → abgeschnitten
					if (lenBytes.length < 4) throw new BackupFormatError('corrupt', MSG_CORRUPT());
					const len = Buffer.from(lenBytes).readUInt32BE(0);
					if (len > BACKUP_LIMITS.envelopeChunkBytes) {
						throw new BackupFormatError('corrupt', MSG_CORRUPT());
					}
					const body = await reader.readUpTo(len + TAG_BYTES);
					if (body.length < len + TAG_BYTES) throw new BackupFormatError('corrupt', MSG_CORRUPT());
					const ct = body.subarray(0, len);
					const tag = body.subarray(len);
					const isLast = await reader.atEnd();
					const plain = tryOpen(key, header, counter, isLast, ct, tag);
					if (!plain) {
						// Passt der Chunk mit dem anderen Final-Flag, ist die Struktur kaputt (abgeschnitten/angehängt).
						if (tryOpen(key, header, counter, !isLast, ct, tag)) {
							throw new BackupFormatError('corrupt', MSG_CORRUPT());
						}
						if (counter === 0) throw new BackupFormatError('wrong_password', MSG_WRONG_PASSWORD());
						throw new BackupFormatError('corrupt', MSG_CORRUPT());
					}
					if (plain.length > 0) yield plain;
					if (isLast) return;
				}
			} finally {
				await reader.close();
			}
		}
	};
}
