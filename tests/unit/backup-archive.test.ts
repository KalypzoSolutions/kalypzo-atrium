import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import {
	createArchiveWriter,
	isAllowedEntryName,
	ndjsonSource,
	readArchive,
	readNdjson
} from '$lib/server/core/backup/archive';
import {
	createEnvelopeWriter,
	decryptEnvelope,
	deriveEnvelopeKey,
	readEnvelopeHeader
} from '$lib/server/core/backup/envelope';
import { bufferSource, collect, concatBytes, fileSink } from '$lib/server/core/backup/io';
import {
	BACKUP_LIMITS,
	BackupFormatError,
	type ByteSink,
	type ByteSource
} from '$lib/server/core/backup/types';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function memorySink(): ByteSink & { bytes(): Uint8Array; closed: boolean } {
	const parts: Uint8Array[] = [];
	const s = {
		closed: false,
		async write(c: Uint8Array) {
			parts.push(Uint8Array.from(c));
		},
		async close() {
			s.closed = true;
		},
		bytes: () => concatBytes(parts)
	};
	return s;
}

/** Bytes in zufällig große Blöcke zerlegen (1 … max) */
function chunked(data: Uint8Array, max: number, seed = 1): ByteSource {
	return {
		async *[Symbol.asyncIterator]() {
			let x = seed;
			let off = 0;
			while (off < data.length) {
				x = (x * 1103515245 + 12345) % 2147483648;
				const n = 1 + (x % max);
				yield data.subarray(off, off + n);
				off += n;
			}
		}
	};
}

async function readAll(source: ByteSource) {
	const out: { name: string; data: Uint8Array }[] = [];
	for await (const e of readArchive(source)) {
		out.push({ name: e.name, data: await collect(e.stream()) });
	}
	return out;
}

async function expectCode(p: Promise<unknown>, code: BackupFormatError['code']) {
	const err = await p.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(BackupFormatError);
	expect((err as BackupFormatError).code).toBe(code);
}

const big = randomBytes(3 * 1024 * 1024);
const text = strToU8('{"a":1}\n{"b":"äöüß"}\n'.repeat(20_000));

async function sampleArchive() {
	const sink = memorySink();
	const w = createArchiveWriter(sink);
	await w.addEntry('backup.json', strToU8('{"format":"ep-intern-backup"}'));
	await w.addEntry('data/public.user.ndjson', chunked(text, 3000));
	await w.addEntry('data/mod_members.empty.ndjson', new Uint8Array(0));
	await w.addEntry('files/core/avatar-1', bufferSource(big), { level: 1 });
	await w.addEntry('checksums.json', strToU8('{"entries":{}}'));
	await w.finish();
	return { sink, stats: w.stats(), zip: sink.bytes() };
}

let dir: string;
beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'ep-backup-zip-'));
});
afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

const saved = { ...BACKUP_LIMITS };
afterEach(() => {
	Object.assign(BACKUP_LIMITS, saved);
});
const limits = BACKUP_LIMITS as unknown as Record<string, number>;

describe('Archiv schreiben/lesen', () => {
	it('Roundtrip mehrerer Einträge inkl. 3 MB binär, stats() korrekt', async () => {
		const { sink, stats, zip } = await sampleArchive();
		expect(sink.closed).toBe(true);
		expect(stats['files/core/avatar-1']).toEqual({ sha256: sha(big), bytes: big.length });
		expect(stats['data/public.user.ndjson']).toEqual({ sha256: sha(text), bytes: text.length });
		expect(stats['data/mod_members.empty.ndjson']).toEqual({
			sha256: sha(new Uint8Array(0)),
			bytes: 0
		});

		const entries = await readAll(bufferSource(zip));
		expect(entries.map((e) => e.name)).toEqual([
			'backup.json',
			'data/public.user.ndjson',
			'data/mod_members.empty.ndjson',
			'files/core/avatar-1',
			'checksums.json'
		]);
		for (const e of entries) expect(sha(e.data)).toBe(stats[e.name]!.sha256);

		// gültiges ZIP auch für andere Leser
		const viaFflate = unzipSync(zip);
		expect(sha(viaFflate['files/core/avatar-1']!)).toBe(sha(big));
	});

	it('liest auch aus vielen kleinen Blöcken', async () => {
		const { stats, zip } = await sampleArchive();
		const entries = await readAll(chunked(zip, 4096, 7));
		expect(entries).toHaveLength(5);
		for (const e of entries) expect(sha(e.data)).toBe(stats[e.name]!.sha256);
	});

	it('liest byteweise (kleines Archiv)', async () => {
		const sink = memorySink();
		const w = createArchiveWriter(sink);
		await w.addEntry('backup.json', strToU8('{"x":1}'));
		await w.addEntry('data/a.b.ndjson', randomBytes(5000));
		await w.finish();
		const entries = await readAll(chunked(sink.bytes(), 1));
		expect(entries.map((e) => [e.name, sha(e.data)])).toEqual(
			Object.entries(w.stats()).map(([n, s]) => [n, s.sha256])
		);
	});

	it('nicht gelesene Einträge werden übersprungen (skip und automatisch)', async () => {
		const { zip, stats } = await sampleArchive();
		const seen: string[] = [];
		for await (const e of readArchive(bufferSource(zip))) {
			seen.push(e.name);
			if (e.name === 'data/public.user.ndjson') await e.skip();
			if (e.name === 'checksums.json')
				expect(sha(await collect(e.stream()))).toBe(stats[e.name]!.sha256);
			if (e.name === 'files/core/avatar-1') {
				// nur den Anfang lesen, dann abbrechen
				for await (const c of e.stream()) {
					expect(c.length).toBeGreaterThan(0);
					break;
				}
			}
		}
		expect(seen).toHaveLength(5);
	});

	it('liest ZIPs mit bekannten Größen (ohne Data Descriptor), gespeichert und komprimiert', async () => {
		const files: Zippable = {
			'backup.json': [strToU8('{"x":1}'), { level: 0 }],
			'data/a.b.ndjson': [text, { level: 6 }]
		};
		const entries = await readAll(chunked(zipSync(files), 1000));
		expect(entries.map((e) => e.name)).toEqual(['backup.json', 'data/a.b.ndjson']);
		expect(sha(entries[1]!.data)).toBe(sha(text));
	});

	it.each([
		'evil.txt',
		'../backup.json',
		'files/../../etc/passwd',
		'/backup.json',
		'data/',
		'files/core/',
		'files/core/a/b',
		'data/Public.user.ndjson',
		'files\\core\\x'
	])('unerlaubter Name %s', async (name) => {
		expect(isAllowedEntryName(name)).toBe(false);
		await expectCode(
			createArchiveWriter(memorySink()).addEntry(name, new Uint8Array(1)),
			'invalid_entry'
		);
		const zip = zipSync({ 'backup.json': strToU8('{}'), [name]: strToU8('böse') });
		await expectCode(readAll(bufferSource(zip)), 'invalid_entry');
	});

	it('doppelter Name → invalid_entry', async () => {
		const w = createArchiveWriter(memorySink());
		await w.addEntry('backup.json', strToU8('{}'));
		await expectCode(w.addEntry('backup.json', strToU8('{}')), 'invalid_entry');
	});

	it('Grenze je Eintrag → too_large', async () => {
		const { zip } = await sampleArchive();
		limits.maxEntryBytes = 1024 * 1024;
		await expectCode(readAll(bufferSource(zip)), 'too_large');
	});

	it('Grenze entpackte Gesamtgröße (Zip-Bombe) → too_large', async () => {
		const sink = memorySink();
		const w = createArchiveWriter(sink);
		await w.addEntry('files/core/zeros', new Uint8Array(20 * 1024 * 1024), { level: 9 });
		await w.finish();
		expect(sink.bytes().length).toBeLessThan(100_000);
		limits.maxUnpackedBytes = 5 * 1024 * 1024;
		await expectCode(readAll(bufferSource(sink.bytes())), 'too_large');
	});

	it('Grenze Anzahl Einträge → too_large', async () => {
		const { zip } = await sampleArchive();
		limits.maxEntries = 3;
		await expectCode(readAll(bufferSource(zip)), 'too_large');
	});

	it('kaputte Daten / abgeschnitten → corrupt', async () => {
		const { zip } = await sampleArchive();
		await expectCode(readAll(bufferSource(zip.subarray(0, zip.length >> 1))), 'corrupt');
		const bad = Uint8Array.from(zip);
		bad[bad.length >> 1]! ^= 0xff; // irgendwo im 3-MB-Eintrag
		await expectCode(readAll(bufferSource(bad)), 'corrupt');
		await expectCode(readAll(bufferSource(strToU8('kein zip'))), 'corrupt');
	});
});

describe('ndjson', () => {
	async function* lines(xs: string[]) {
		for (const x of xs) yield x;
	}

	it('Roundtrip, auch über Blockgrenzen', async () => {
		const rows = Array.from({ length: 5000 }, (_, i) => ({
			id: i,
			name: `Zeile ${i} äöü ß`,
			n: null
		}));
		const bytes = await collect(ndjsonSource(lines(rows.map((r) => JSON.stringify(r)))));
		const back: unknown[] = [];
		for await (const r of readNdjson(chunked(bytes, 333))) back.push(r);
		expect(back).toEqual(rows);
	});

	it('leere Quelle', async () => {
		const back: unknown[] = [];
		for await (const r of readNdjson(ndjsonSource(lines([])))) back.push(r);
		expect(back).toEqual([]);
	});

	it('kaputte Zeile → corrupt', async () => {
		const run = async () => {
			for await (const r of readNdjson(bufferSource(strToU8('{"a":1}\n{"b":\n')))) void r;
		};
		await expectCode(run(), 'corrupt');
	});

	it('Zeile zu lang → too_large', async () => {
		limits.maxLineBytes = 100;
		const run = async () => {
			for await (const r of readNdjson(chunked(strToU8(`"${'x'.repeat(200)}"\n`), 30))) void r;
		};
		await expectCode(run(), 'too_large');
	});
});

describe('Kette Hülle(Archiv) über Temp-Datei', () => {
	it('schreibt und liest eine komplette Sicherung', async () => {
		const path = join(dir, 'kette.epbackup');
		const pw = 'ein-sehr-sicheres-Passwort';
		const env = await createEnvelopeWriter(await fileSink(path), pw, {
			params: { N: 2 ** 10, r: 8, p: 1 }
		});
		const w = createArchiveWriter(env);
		await w.addEntry('backup.json', strToU8('{"format":"ep-intern-backup"}'));
		await w.addEntry(
			'data/public.user.ndjson',
			ndjsonSource(lines(Array.from({ length: 1000 }, (_, i) => JSON.stringify({ id: i }))))
		);
		await w.addEntry('files/core/avatar-1', big, { level: 1 });
		await w.addEntry('checksums.json', strToU8(JSON.stringify({ entries: w.stats() })));
		await w.finish();
		const stats = w.stats();

		const header = await readEnvelopeHeader(path);
		const key = await deriveEnvelopeKey(header, pw);
		const names: string[] = [];
		let rows = 0;
		for await (const e of readArchive(decryptEnvelope(path, header, key))) {
			names.push(e.name);
			if (e.name === 'data/public.user.ndjson') {
				for await (const r of readNdjson(e.stream())) {
					expect(r).toEqual({ id: rows });
					rows++;
				}
			} else {
				expect(sha(await collect(e.stream()))).toBe(stats[e.name]!.sha256);
			}
		}
		expect(names).toEqual([
			'backup.json',
			'data/public.user.ndjson',
			'files/core/avatar-1',
			'checksums.json'
		]);
		expect(rows).toBe(1000);
	});

	async function* lines(xs: string[]) {
		for (const x of xs) yield x;
	}
});
