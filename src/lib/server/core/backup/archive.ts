/**
 * Datensicherung – ZIP im Inneren der Hülle (gestreamt schreiben und lesen) sowie ndjson-Hilfen.
 *
 * Schreiben: fflate `Zip` + `ZipDeflate`. Jeder Eintrag hat einen Data Descriptor (Größen/CRC erst nach
 * den Daten), daher ist das ZIP ohne Puffern beliebig großer Einträge erzeugbar.
 *
 * Lesen: eigener kleiner Leser statt fflate `Unzip`. `Unzip` erkennt das Ende eines Eintrags mit Data
 * Descriptor durch Suche nach der Signatur `PK\x07\x08` bzw. `PK\x03\x04` in den komprimierten Bytes –
 * bei Binärdaten sind Fehltreffer möglich, und die Suche läuft Byte für Byte. Stattdessen:
 *   Local File Header lesen → Daten mit `node:zlib` `InflateRaw` entpacken. Der Inflater hört am Ende
 *   des Deflate-Stroms selbst auf; `bytesWritten` nennt die genau verbrauchten Eingabebytes, der Rest
 *   wird zurückgelegt → Data Descriptor lesen und CRC-32 sowie beide Größen prüfen.
 * Eingaben werden in kleinen Stücken (32 KiB) verfüttert, damit eine Zip-Bombe höchstens ~33 MB je
 * Schritt erzeugt, bevor die Grenzen (`BACKUP_LIMITS`) greifen. Das zentrale Verzeichnis am Ende wird
 * nur überlesen (fflate schreibt kein ZIP64; Offsets > 4 GB wären dort falsch, stören diesen Leser aber nicht).
 */
import { createInflateRaw, crc32, type InflateRaw } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Zip, ZipDeflate, type DeflateOptions } from 'fflate';
import { ByteReader, bufferSource } from './io';
import {
	BACKUP_LIMITS,
	BackupFormatError,
	ENTRY_CHECKSUMS,
	ENTRY_DATA,
	ENTRY_FILE,
	ENTRY_META,
	type ArchiveEntry,
	type ArchiveWriter,
	type ByteSink,
	type ByteSource
} from './types';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_DESCRIPTOR = 0x08074b50;
const FEED_SLICE = 32 * 1024;
const WRITE_SLICE = 1024 * 1024;

const MSG_CORRUPT = 'Die Sicherungsdatei ist beschädigt oder unvollständig.';
const MSG_TOO_LARGE = 'Die Sicherung überschreitet die erlaubte Größe.';

const corrupt = (msg = MSG_CORRUPT) => new BackupFormatError('corrupt', msg);
const tooLarge = () => new BackupFormatError('too_large', MSG_TOO_LARGE);

/** Erlaubter Eintragsname (nur die vier Formen aus dem Vertrag, keine Pfadtricks) */
export function isAllowedEntryName(name: string): boolean {
	if (!name || name.length > 300) return false;
	if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.endsWith('/')) {
		return false;
	}
	if (name.split('/').some((s) => s === '' || s === '.' || s === '..')) return false;
	return (
		name === ENTRY_META ||
		name === ENTRY_CHECKSUMS ||
		ENTRY_DATA.test(name) ||
		ENTRY_FILE.test(name)
	);
}

function assertEntryName(name: string): void {
	if (!isAllowedEntryName(name)) {
		throw new BackupFormatError(
			'invalid_entry',
			'Die Sicherung enthält einen unerlaubten Eintrag.'
		);
	}
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------

export function createArchiveWriter(
	sink: ByteSink
): ArchiveWriter & { stats(): Record<string, { sha256: string; bytes: number }> } {
	let chain: Promise<void> = Promise.resolve();
	let failure: unknown = null;
	const zip = new Zip((err, data) => {
		if (err) {
			failure ??= err;
			return;
		}
		if (data.length === 0) return;
		chain = chain.then(() => sink.write(data));
		chain.catch((e: unknown) => {
			failure ??= e;
		});
	});
	const stats: Record<string, { sha256: string; bytes: number }> = {};
	const names = new Set<string>();
	let busy = false;
	let finished = false;

	const flush = async () => {
		await chain;
		if (failure) throw failure;
	};

	return {
		async addEntry(name, data, opts = {}) {
			if (finished) throw new Error('Archiv ist bereits abgeschlossen');
			if (busy) throw new Error('Einträge müssen nacheinander hinzugefügt werden');
			assertEntryName(name);
			if (names.has(name)) {
				throw new BackupFormatError('invalid_entry', 'Doppelter Eintrag in der Sicherung.');
			}
			names.add(name);
			busy = true;
			try {
				const file = new ZipDeflate(name, { level: (opts.level ?? 6) as DeflateOptions['level'] });
				zip.add(file);
				const hash = createHash('sha256');
				let bytes = 0;
				const source: ByteSource = data instanceof Uint8Array ? bufferSource(data) : data;
				for await (const chunk of source) {
					for (let off = 0; off < chunk.length; off += WRITE_SLICE) {
						const part = chunk.subarray(off, off + WRITE_SLICE);
						hash.update(part);
						bytes += part.length;
						file.push(part, false);
						await flush();
					}
				}
				file.push(new Uint8Array(0), true);
				await flush();
				stats[name] = { sha256: hash.digest('hex'), bytes };
			} finally {
				busy = false;
			}
		},
		async finish() {
			if (finished) return;
			if (busy) throw new Error('Eintrag noch nicht abgeschlossen');
			finished = true;
			zip.end();
			await flush();
			await sink.close();
		},
		stats() {
			return { ...stats };
		}
	};
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) =>
	(b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) + b[o + 3]! * 0x1000000;

/** Dünne Hülle um `InflateRaw`: verfüttern, Ausgabe abholen, Ende des Deflate-Stroms erkennen. */
class Inflater {
	private readonly z: InflateRaw = createInflateRaw();
	private out: Buffer[] = [];
	private ended = false;
	error: Error | null = null;
	fed = 0;

	constructor() {
		this.z.on('data', (d: Buffer) => this.out.push(d));
		this.z.on('end', () => {
			this.ended = true;
		});
		this.z.on('error', (e: Error) => {
			this.error ??= e;
		});
	}

	/** Verbrauchte Eingabebytes */
	get consumed(): number {
		return this.z.bytesWritten;
	}

	/** Deflate-Strom zu Ende (der Inflater nimmt nichts mehr an)? */
	get finished(): boolean {
		return this.ended || this.z.bytesWritten < this.fed;
	}

	private waitFor(start: (done: () => void) => void): Promise<void> {
		return new Promise<void>((resolve) => {
			const done = () => {
				this.z.off('end', done);
				this.z.off('error', done);
				this.z.off('close', done);
				resolve();
			};
			this.z.once('end', done);
			this.z.once('error', done);
			this.z.once('close', done);
			start(done);
		});
	}

	async feed(chunk: Uint8Array): Promise<void> {
		this.fed += chunk.length;
		await this.waitFor((done) => this.z.write(chunk, () => done()));
		await new Promise<void>((r) => setImmediate(r));
		// Vorzeitiges Ende erkannt: auf 'end' warten, damit alle Ausgaben angekommen sind
		if (!this.ended && !this.error && this.z.bytesWritten < this.fed) {
			await this.waitFor(() => {});
		}
	}

	/** Eingabe abschließen (Größe war bekannt) */
	async end(): Promise<void> {
		if (this.ended || this.error) return;
		await this.waitFor((done) => {
			this.z.end();
			if (this.ended) done();
		});
	}

	drain(): Buffer[] {
		const o = this.out;
		this.out = [];
		return o;
	}

	destroy(): void {
		this.z.removeAllListeners('data');
		this.z.on('error', () => {});
		this.z.destroy();
	}
}

interface LocalHeader {
	name: string;
	method: number;
	descriptor: boolean;
	crc: number;
	csize: number;
	usize: number;
}

/**
 * Liest das ZIP streamend; Einträge in Reihenfolge. Ein Eintrag, der nicht gelesen wurde, wird beim
 * Weitergehen automatisch übersprungen. Zum Schluss wird die Quelle bis zum Ende gelesen (damit die
 * Hülle ihr Ende prüfen kann).
 */
export function readArchive(source: ByteSource): AsyncIterable<ArchiveEntry> {
	return {
		async *[Symbol.asyncIterator]() {
			const reader = new ByteReader(source);
			const names = new Set<string>();
			let entries = 0;
			let unpacked = 0;
			try {
				for (;;) {
					const sigBytes = await reader.readUpTo(4);
					if (sigBytes.length < 4) throw corrupt();
					const sig = u32(sigBytes, 0);
					if (sig === SIG_CENTRAL || sig === SIG_END) {
						// Zentrales Verzeichnis überlesen (Einträge sind schon geprüft)
						while ((await reader.next()).length > 0) {
							/* verwerfen */
						}
						return;
					}
					if (sig !== SIG_LOCAL) throw corrupt();
					const h = await reader.readUpTo(26);
					if (h.length < 26) throw corrupt();
					const flags = u16(h, 2);
					const method = u16(h, 4);
					const nameLen = u16(h, 22);
					const extraLen = u16(h, 24);
					const nameBytes = await reader.readUpTo(nameLen);
					const extra = await reader.readUpTo(extraLen);
					if (nameBytes.length < nameLen || extra.length < extraLen) throw corrupt();
					let name: string;
					try {
						name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
					} catch {
						throw new BackupFormatError(
							'invalid_entry',
							'Ungültiger Eintragsname in der Sicherung.'
						);
					}
					assertEntryName(name);
					if (names.has(name)) {
						throw new BackupFormatError('invalid_entry', 'Doppelter Eintrag in der Sicherung.');
					}
					names.add(name);
					if (++entries > BACKUP_LIMITS.maxEntries) throw tooLarge();
					const header: LocalHeader = {
						name,
						method,
						descriptor: (flags & 8) !== 0,
						crc: u32(h, 10),
						csize: u32(h, 14),
						usize: u32(h, 18)
					};
					if (flags & 1) {
						throw new BackupFormatError(
							'unsupported',
							'Verschlüsselte ZIP-Einträge werden nicht unterstützt.'
						);
					}
					if (method !== 8 && !(method === 0 && !header.descriptor)) {
						throw new BackupFormatError(
							'unsupported',
							'Nicht unterstützte Kompression in der Sicherung.'
						);
					}
					if (!header.descriptor) {
						if (header.csize === 0xffffffff || header.usize === 0xffffffff) {
							throw new BackupFormatError('unsupported', 'ZIP64 wird nicht unterstützt.');
						}
						if (header.usize > BACKUP_LIMITS.maxEntryBytes) throw tooLarge();
					}

					let state: 'pending' | 'reading' | 'done' | 'failed' = 'pending';
					const body = async function* (): AsyncGenerator<Uint8Array> {
						let bytes = 0;
						let crc = 0;
						const emit = (b: Uint8Array) => {
							bytes += b.length;
							unpacked += b.length;
							if (
								bytes > BACKUP_LIMITS.maxEntryBytes ||
								unpacked > BACKUP_LIMITS.maxUnpackedBytes
							) {
								throw tooLarge();
							}
							crc = crc32(b, crc);
						};
						try {
							let compressed = 0;
							if (header.method === 0) {
								let rest = header.csize;
								while (rest > 0) {
									const c = await reader.next(Math.min(rest, FEED_SLICE));
									if (c.length === 0) throw corrupt();
									rest -= c.length;
									emit(c);
									yield c;
								}
								compressed = header.csize;
							} else {
								const inf = new Inflater();
								try {
									let rest = header.descriptor ? Infinity : header.csize;
									while (!inf.finished && rest > 0) {
										const c = await reader.next(Math.min(rest, FEED_SLICE));
										if (c.length === 0) throw corrupt();
										if (rest !== Infinity) rest -= c.length;
										await inf.feed(c);
										if (inf.error) throw corrupt();
										for (const o of inf.drain()) {
											emit(o);
											yield o;
										}
										if (inf.finished) {
											const leftover = inf.fed - inf.consumed;
											if (leftover > 0) reader.unshift(c.subarray(c.length - leftover));
										}
									}
									if (!inf.finished) {
										// Größe war bekannt: Strom muss genau hier enden
										await inf.end();
										if (inf.error) throw corrupt();
										for (const o of inf.drain()) {
											emit(o);
											yield o;
										}
									}
									compressed = inf.consumed;
									if (!header.descriptor && compressed !== header.csize) throw corrupt();
								} finally {
									inf.destroy();
								}
							}
							let expected = { crc: header.crc, csize: header.csize, usize: header.usize };
							if (header.descriptor) {
								const first = await reader.readUpTo(4);
								if (first.length < 4) throw corrupt();
								let d: Uint8Array;
								if (u32(first, 0) === SIG_DESCRIPTOR) {
									d = await reader.readUpTo(12);
								} else {
									const more = await reader.readUpTo(8);
									d = new Uint8Array(12);
									d.set(first, 0);
									d.set(more, 4);
									if (more.length < 8) throw corrupt();
								}
								if (d.length < 12) throw corrupt();
								expected = { crc: u32(d, 0), csize: u32(d, 4), usize: u32(d, 8) };
							}
							if (
								expected.crc !== crc >>> 0 ||
								expected.csize !== compressed % 0x100000000 ||
								expected.usize !== bytes % 0x100000000
							) {
								throw corrupt();
							}
							state = 'done';
						} catch (e) {
							state = 'failed';
							throw e;
						}
					};

					let inner: AsyncGenerator<Uint8Array> | null = null;
					const start = () => {
						if (state !== 'pending') throw new Error('Eintrag wurde bereits gelesen');
						state = 'reading';
						inner = body();
						return inner;
					};
					const entry: ArchiveEntry = {
						name,
						stream() {
							return {
								async *[Symbol.asyncIterator]() {
									const it = start();
									try {
										for (;;) {
											const r = await it.next();
											if (r.done) break;
											yield r.value;
										}
									} finally {
										// Abbruch durch den Aufrufer → Rest überlesen, damit der nächste Eintrag stimmt
										if (state === 'reading') {
											for (;;) {
												const r = await it.next();
												if (r.done) break;
											}
										}
									}
								}
							};
						},
						async skip() {
							if (state === 'done') return;
							const it = inner ?? start();
							for (;;) {
								const r = await it.next();
								if (r.done) break;
							}
						}
					};
					yield entry;
					if (state === 'pending') await entry.skip();
					else if (state === 'reading') {
						throw new Error('Eintrag muss vollständig gelesen werden, bevor der nächste kommt');
					} else if (state === 'failed') throw corrupt();
				}
			} finally {
				await reader.close();
			}
		}
	};
}

// ---------------------------------------------------------------------------
// ndjson
// ---------------------------------------------------------------------------

const NDJSON_BLOCK = 64 * 1024;

/** Zeilen als UTF-8 mit `\n`; kleine Zeilen werden zu Blöcken von ~64 KiB gebündelt. */
export function ndjsonSource(lines: AsyncIterable<string>): ByteSource {
	return {
		async *[Symbol.asyncIterator]() {
			const enc = new TextEncoder();
			let parts: Uint8Array[] = [];
			let size = 0;
			const nl = new Uint8Array([10]);
			for await (const line of lines) {
				if (line.includes('\n')) throw new Error('ndjson-Zeile enthält einen Zeilenumbruch');
				const b = enc.encode(line);
				parts.push(b, nl);
				size += b.length + 1;
				if (size >= NDJSON_BLOCK) {
					yield Buffer.concat(parts, size);
					parts = [];
					size = 0;
				}
			}
			if (size > 0) yield Buffer.concat(parts, size);
		}
	};
}

/** Zeilenweise `JSON.parse`; leere Zeilen werden übersprungen. */
export function readNdjson(source: ByteSource): AsyncIterable<unknown> {
	return {
		async *[Symbol.asyncIterator]() {
			const dec = new TextDecoder('utf-8', { fatal: true });
			let carry: Uint8Array[] = [];
			let carryLen = 0;
			const parse = (bytes: Uint8Array): unknown => {
				let text: string;
				try {
					text = dec.decode(bytes);
				} catch {
					throw corrupt();
				}
				try {
					return JSON.parse(text);
				} catch {
					throw corrupt();
				}
			};
			const tooLong = () =>
				new BackupFormatError(
					'too_large',
					`Eine Datenzeile der Sicherung ist größer als ${BACKUP_LIMITS.maxLineBytes / 1024 ** 2} MB.`
				);
			for await (const chunk of source) {
				let off = 0;
				for (;;) {
					const i = chunk.indexOf(10, off);
					if (i < 0) break;
					const piece = chunk.subarray(off, i);
					off = i + 1;
					let line: Uint8Array;
					if (carryLen > 0) {
						if (carryLen + piece.length > BACKUP_LIMITS.maxLineBytes) throw tooLong();
						carry.push(piece);
						line = Buffer.concat(carry, carryLen + piece.length);
						carry = [];
						carryLen = 0;
					} else {
						line = piece;
					}
					if (line.length > BACKUP_LIMITS.maxLineBytes) throw tooLong();
					if (line.length > 0) yield parse(line);
				}
				if (off < chunk.length) {
					const rest = chunk.subarray(off);
					carryLen += rest.length;
					if (carryLen > BACKUP_LIMITS.maxLineBytes) throw tooLong();
					// Kopie: die Quelle darf ihren Puffer wiederverwenden
					carry.push(Uint8Array.from(rest));
				}
			}
			if (carryLen > 0) {
				const line = Buffer.concat(carry, carryLen);
				if (line.length > 0) yield parse(line);
			}
		}
	};
}
