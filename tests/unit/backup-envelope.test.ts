import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createEnvelopeWriter,
	decryptEnvelope,
	deriveEnvelopeKey,
	ENVELOPE_HEADER_BYTES,
	readEnvelopeHeader
} from '$lib/server/core/backup/envelope';
import {
	bufferSource,
	collect,
	fileSink,
	fileSource,
	hashingSource
} from '$lib/server/core/backup/io';
import { BACKUP_LIMITS, BackupFormatError } from '$lib/server/core/backup/types';

const PARAMS = { N: 2 ** 10, r: 8, p: 1 };
const PW = 'richtig-langes-Passwort-ä';
const CHUNK = BACKUP_LIMITS.envelopeChunkBytes;
const FRAME = 4 + CHUNK + 16;

let dir: string;
let n = 0;
const tmp = () => join(dir, `f${n++}.epbackup`);

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'ep-backup-env-'));
});
afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function seal(data: Uint8Array, writeSizes?: number[]): Promise<string> {
	const path = tmp();
	const w = await createEnvelopeWriter(await fileSink(path), PW, { params: PARAMS });
	if (writeSizes) {
		let off = 0;
		for (const s of writeSizes) {
			await w.write(data.subarray(off, off + s));
			off += s;
		}
		await w.write(data.subarray(off));
	} else {
		await w.write(data);
	}
	await w.close();
	return path;
}

async function open(path: string, password = PW): Promise<Uint8Array> {
	const header = await readEnvelopeHeader(path);
	const key = await deriveEnvelopeKey(header, password);
	return collect(decryptEnvelope(path, header, key));
}

async function expectCode(p: Promise<unknown>, code: BackupFormatError['code']) {
	const err = await p.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(BackupFormatError);
	expect((err as BackupFormatError).code).toBe(code);
	return err as BackupFormatError;
}

describe('io', () => {
	it('collect begrenzt die Größe', async () => {
		await expect(collect(bufferSource(new Uint8Array(10)), 10)).resolves.toHaveLength(10);
		await expectCode(collect(bufferSource(new Uint8Array(11)), 10), 'too_large');
	});

	it('hashingSource liefert sha256 und Bytes', async () => {
		let r: { sha256: string; bytes: number } | null = null;
		const out = await collect(
			hashingSource(bufferSource(new TextEncoder().encode('abc')), (x) => (r = x))
		);
		expect(out).toHaveLength(3);
		expect(r).toEqual({
			sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
			bytes: 3
		});
	});

	it('fileSink/fileSource mit Start und kleinen Blöcken', async () => {
		const path = tmp();
		const data = randomBytes(1000);
		const sink = await fileSink(path);
		await sink.write(data.subarray(0, 400));
		await sink.write(data.subarray(400));
		await sink.close();
		const back = await collect(fileSource(path, { start: 100, chunkBytes: 7 }));
		expect(Buffer.from(back).equals(data.subarray(100))).toBe(true);
	});
});

describe('envelope', () => {
	it.each([
		['leer', 0],
		['kleiner als ein Chunk', 1234],
		['genau ein Chunk', CHUNK],
		['mehrere Chunks', 2 * CHUNK + 777]
	])('Roundtrip: %s', async (_label, size) => {
		const data = randomBytes(size);
		const path = await seal(data);
		const back = await open(path);
		expect(back.length).toBe(size);
		expect(Buffer.from(back).equals(data)).toBe(true);
	});

	it('Roundtrip mit vielen kleinen Schreibvorgängen', async () => {
		const data = randomBytes(CHUNK + 5000);
		const sizes = Array.from({ length: 300 }, (_, i) => (i * 37) % 5000);
		const path = await seal(data, sizes);
		expect(Buffer.from(await open(path)).equals(data)).toBe(true);
	});

	it('Header: Parameter und Länge', async () => {
		const path = await seal(new Uint8Array(0));
		const header = await readEnvelopeHeader(path);
		expect(header.params).toEqual(PARAMS);
		expect(header.raw).toHaveLength(ENVELOPE_HEADER_BYTES);
		expect(header.salt).toHaveLength(16);
		expect(header.noncePrefix).toHaveLength(7);
		// leer = Header + ein leerer Final-Chunk
		expect((await readFile(path)).length).toBe(ENVELOPE_HEADER_BYTES + 4 + 16);
	});

	it('falsches Passwort → wrong_password', async () => {
		const path = await seal(randomBytes(3000));
		const err = await expectCode(open(path, 'falsches-Passwort-123'), 'wrong_password');
		expect(err.message).toContain('Sicherungs-Passwort ist falsch');
	});

	it('manipuliertes Byte im 2. Chunk → corrupt', async () => {
		const path = await seal(randomBytes(2 * CHUNK + 10));
		const buf = await readFile(path);
		buf[ENVELOPE_HEADER_BYTES + FRAME + 100]! ^= 0x01;
		await writeFile(path, buf);
		await expectCode(open(path), 'corrupt');
	});

	it('manipuliertes Byte im 1. Chunk → wrong_password (nicht unterscheidbar)', async () => {
		const path = await seal(randomBytes(500));
		const buf = await readFile(path);
		buf[ENVELOPE_HEADER_BYTES + 10]! ^= 0x01;
		await writeFile(path, buf);
		await expectCode(open(path), 'wrong_password');
	});

	it('manipulierter Header (AAD) → wrong_password', async () => {
		const path = await seal(randomBytes(500));
		const buf = await readFile(path);
		buf[ENVELOPE_HEADER_BYTES - 1]! ^= 0x01; // Nonce-Präfix
		await writeFile(path, buf);
		await expectCode(open(path), 'wrong_password');
	});

	it('abgeschnitten an Chunkgrenze (Final fehlt) → corrupt', async () => {
		const path = await seal(randomBytes(2 * CHUNK + 10));
		const buf = await readFile(path);
		await writeFile(path, buf.subarray(0, ENVELOPE_HEADER_BYTES + 2 * FRAME));
		await expectCode(open(path), 'corrupt');
	});

	it('mitten im Chunk abgeschnitten → corrupt', async () => {
		const path = await seal(randomBytes(2 * CHUNK + 10));
		const buf = await readFile(path);
		await writeFile(path, buf.subarray(0, buf.length - 5));
		await expectCode(open(path), 'corrupt');
	});

	it('angehängte Bytes → corrupt', async () => {
		const path = await seal(randomBytes(CHUNK + 10));
		const buf = await readFile(path);
		await writeFile(path, Buffer.concat([buf, Buffer.from('noch mehr')]));
		await expectCode(open(path), 'corrupt');
	});

	it('angehängter kompletter Chunk-Rahmen → corrupt', async () => {
		const path = await seal(randomBytes(CHUNK + 10));
		const buf = await readFile(path);
		const lastFrame = buf.subarray(ENVELOPE_HEADER_BYTES + FRAME);
		await writeFile(path, Buffer.concat([buf, lastFrame]));
		await expectCode(open(path), 'corrupt');
	});

	it('vertauschte Chunks → corrupt', async () => {
		const path = await seal(randomBytes(3 * CHUNK + 10));
		const buf = await readFile(path);
		const h = ENVELOPE_HEADER_BYTES;
		const c1 = buf.subarray(h + FRAME, h + 2 * FRAME);
		const c2 = buf.subarray(h + 2 * FRAME, h + 3 * FRAME);
		const swapped = Buffer.concat([
			buf.subarray(0, h + FRAME),
			c2,
			c1,
			buf.subarray(h + 3 * FRAME)
		]);
		await writeFile(path, swapped);
		await expectCode(open(path), 'corrupt');
	});

	it('Chunk-Länge über dem Maximum → corrupt', async () => {
		const path = await seal(randomBytes(100));
		const buf = await readFile(path);
		buf.writeUInt32BE(CHUNK + 1, ENVELOPE_HEADER_BYTES);
		await writeFile(path, buf);
		await expectCode(open(path), 'corrupt');
	});

	it.each([
		['N zu groß', (b: Buffer) => b.writeUInt32BE(2 ** 21, 5)],
		['N keine Zweierpotenz', (b: Buffer) => b.writeUInt32BE(1000, 5)],
		['r zu groß', (b: Buffer) => b.writeUInt8(17, 9)],
		['p zu groß', (b: Buffer) => b.writeUInt8(5, 10)],
		['Speicherbedarf zu groß', (b: Buffer) => (b.writeUInt32BE(2 ** 20, 5), b.writeUInt8(16, 9))],
		['Version unbekannt', (b: Buffer) => b.writeUInt8(2, 4)]
	])('überhöhte/ungültige Parameter: %s → unsupported', async (_l, patch) => {
		const path = await seal(randomBytes(10));
		const buf = await readFile(path);
		patch(buf);
		await writeFile(path, buf);
		await expectCode(readEnvelopeHeader(path), 'unsupported');
	});

	it('keine Sicherungsdatei → corrupt', async () => {
		const path = tmp();
		await writeFile(path, 'PK\x03\x04 irgendwas anderes, lang genug für einen Header');
		await expectCode(readEnvelopeHeader(path), 'corrupt');
		await writeFile(path, 'EPBK');
		await expectCode(readEnvelopeHeader(path), 'corrupt');
	});

	it('Schreiber lehnt unzulässige Parameter ab', async () => {
		const sink = { write: async () => {}, close: async () => {} };
		await expectCode(
			createEnvelopeWriter(sink, PW, { params: { N: 2 ** 21, r: 8, p: 1 } }),
			'unsupported'
		);
	});

	it('Standardparameter (N=2^17) funktionieren', async () => {
		const path = tmp();
		const w = await createEnvelopeWriter(await fileSink(path), PW);
		await w.write(new TextEncoder().encode('hallo'));
		await w.close();
		const header = await readEnvelopeHeader(path);
		expect(header.params).toEqual({ N: 2 ** 17, r: 8, p: 1 });
		expect(new TextDecoder().decode(await open(path))).toBe('hallo');
	}, 20_000);
});
