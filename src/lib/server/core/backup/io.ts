/**
 * Datensicherung – kleine Bausteine für Byte-Ströme (Datei-Senke/-Quelle, Puffer, Hash, gepufferter Leser).
 * Reine Node-Hilfen ohne Datenbank oder Core-Services.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { BackupFormatError, type ByteSink, type ByteSource } from './types';
import { t } from '$lib/i18n';

const DEFAULT_READ_CHUNK = 1024 * 1024;

/** Datei-Senke (Modus 0600). `write` wartet, bis der Block an das Betriebssystem übergeben ist. */
export async function fileSink(path: string): Promise<ByteSink> {
	const ws = createWriteStream(path, { flags: 'w', mode: 0o600 });
	let failure: Error | null = null;
	ws.on('error', (err) => {
		failure = err;
	});
	await new Promise<void>((resolve, reject) => {
		ws.once('open', () => resolve());
		ws.once('error', reject);
	});
	let closed = false;
	return {
		write(chunk) {
			if (failure) return Promise.reject(failure);
			if (closed) return Promise.reject(new Error('Datei-Senke ist bereits geschlossen'));
			if (chunk.length === 0) return Promise.resolve();
			return new Promise<void>((resolve, reject) => {
				// Der Callback kommt erst, wenn der Block geschrieben ist → natürliche Backpressure.
				ws.write(chunk, (err) => (err ? reject(err) : resolve()));
			});
		},
		close() {
			if (closed) return Promise.resolve();
			closed = true;
			return new Promise<void>((resolve, reject) => {
				if (failure) {
					ws.destroy();
					reject(failure);
					return;
				}
				ws.once('error', reject);
				ws.end(() => resolve());
			});
		}
	};
}

/** Datei als Byte-Quelle (ab `start`, in Blöcken von `chunkBytes`); jede Iteration öffnet die Datei neu. */
export function fileSource(
	path: string,
	opts: { start?: number; chunkBytes?: number } = {}
): ByteSource {
	const chunkBytes = Math.max(1, opts.chunkBytes ?? DEFAULT_READ_CHUNK);
	const start = Math.max(0, opts.start ?? 0);
	return {
		async *[Symbol.asyncIterator]() {
			const fh = await open(path, 'r');
			try {
				let pos = start;
				for (;;) {
					const buf = Buffer.allocUnsafe(chunkBytes);
					const { bytesRead } = await fh.read(buf, 0, chunkBytes, pos);
					if (bytesRead === 0) break;
					pos += bytesRead;
					yield bytesRead === chunkBytes ? buf : buf.subarray(0, bytesRead);
				}
			} finally {
				await fh.close();
			}
		}
	};
}

/** Puffer als Byte-Quelle (leerer Puffer → keine Blöcke). */
export function bufferSource(data: Uint8Array): ByteSource {
	return {
		async *[Symbol.asyncIterator]() {
			if (data.length > 0) yield data;
		}
	};
}

/** Quelle vollständig einlesen; mehr als `maxBytes` → `BackupFormatError('too_large')`. */
export async function collect(source: ByteSource, maxBytes?: number): Promise<Uint8Array> {
	const parts: Uint8Array[] = [];
	let total = 0;
	for await (const chunk of source) {
		total += chunk.length;
		if (maxBytes !== undefined && total > maxBytes) {
			throw new BackupFormatError('too_large', t('backup.format.entryTooLarge'));
		}
		parts.push(chunk);
	}
	return concatBytes(parts, total);
}

/** Reicht die Blöcke durch und meldet am Ende sha256 (hex) und Byte-Anzahl. */
export function hashingSource(
	source: ByteSource,
	onDone: (r: { sha256: string; bytes: number }) => void
): ByteSource {
	return {
		async *[Symbol.asyncIterator]() {
			const hash = createHash('sha256');
			let bytes = 0;
			for await (const chunk of source) {
				hash.update(chunk);
				bytes += chunk.length;
				yield chunk;
			}
			onDone({ sha256: hash.digest('hex'), bytes });
		}
	};
}

export function concatBytes(parts: Uint8Array[], total?: number): Uint8Array {
	if (parts.length === 1) return parts[0]!;
	const size = total ?? parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(size);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

/**
 * Gepufferter Leser über einer Byte-Quelle: genaue Längen lesen, vorausschauen, Bytes zurücklegen.
 * Hält nur die gerade benötigten Blöcke im Speicher.
 */
export class ByteReader {
	private readonly it: AsyncIterator<Uint8Array>;
	private bufs: Uint8Array[] = [];
	private len = 0;
	private done = false;

	constructor(source: ByteSource) {
		this.it = source[Symbol.asyncIterator]();
	}

	/** Versucht, mindestens `n` Bytes zu puffern; `false` bei vorzeitigem Ende */
	private async fill(n: number): Promise<boolean> {
		while (this.len < n && !this.done) {
			const r = await this.it.next();
			if (r.done) {
				this.done = true;
				break;
			}
			if (r.value.length > 0) {
				this.bufs.push(r.value);
				this.len += r.value.length;
			}
		}
		return this.len >= n;
	}

	/** Genau `n` Bytes; weniger nur, wenn die Quelle vorher endet */
	async readUpTo(n: number): Promise<Uint8Array> {
		await this.fill(n);
		return this.take(Math.min(n, this.len));
	}

	/** Nächster verfügbarer Block (höchstens `max` Bytes); leer = Ende der Quelle */
	async next(max = Number.MAX_SAFE_INTEGER): Promise<Uint8Array> {
		if (this.len === 0 && !(await this.fill(1))) return new Uint8Array(0);
		const first = this.bufs[0]!;
		return this.take(Math.min(first.length, max));
	}

	/** Bytes vorne wieder einreihen */
	unshift(bytes: Uint8Array): void {
		if (bytes.length === 0) return;
		this.bufs.unshift(bytes);
		this.len += bytes.length;
	}

	/** Ende der Quelle erreicht (nichts mehr gepuffert und nichts mehr zu holen)? */
	async atEnd(): Promise<boolean> {
		return !(await this.fill(1));
	}

	async close(): Promise<void> {
		this.bufs = [];
		this.len = 0;
		if (!this.done) {
			this.done = true;
			await this.it.return?.();
		}
	}

	private take(n: number): Uint8Array {
		if (n === 0) return new Uint8Array(0);
		const first = this.bufs[0]!;
		if (first.length === n) {
			this.bufs.shift();
			this.len -= n;
			return first;
		}
		if (first.length > n) {
			this.bufs[0] = first.subarray(n);
			this.len -= n;
			return first.subarray(0, n);
		}
		const out = new Uint8Array(n);
		let off = 0;
		while (off < n) {
			const b = this.bufs[0]!;
			const k = Math.min(b.length, n - off);
			out.set(b.subarray(0, k), off);
			off += k;
			if (k === b.length) this.bufs.shift();
			else this.bufs[0] = b.subarray(k);
		}
		this.len -= n;
		return out;
	}
}
