import { describe, expect, it } from 'vitest';
import type { FilesMeta } from '../../src/lib/modules/files/schemas';
import {
	collectEntries,
	fromFileList,
	makeItems,
	pendingBytes,
	precheck,
	queueProgress,
	summaryToast,
	typeAllowed,
	uploadError,
	type EntryLike,
	type FileLike
} from '../../src/lib/modules/files/pages/upload-queue';

const MB = 1024 * 1024;

function meta(over: Partial<FilesMeta> = {}, quota?: FilesMeta['quota']): FilesMeta {
	return {
		quota: quota ?? { usedBytes: 0, limitBytes: null },
		maxFileBytes: 10 * MB,
		allowedContentTypes: [],
		trashDays: 30,
		can: { sharedView: true, sharedEdit: true, linkCreate: true, manageAll: false },
		...over
	};
}

const f = (name: string, size: number, type = ''): FileLike => ({ name, size, type });
const inp = (file: FileLike, relativePath: string | null = null) => ({ file, relativePath });

describe('typeAllowed', () => {
	it('leere Liste erlaubt alles', () => {
		expect(typeAllowed('application/x-foo', [])).toBe(true);
	});
	it('exakt und mit Platzhalter, ohne Groß/Klein und Parameter', () => {
		const allowed = ['image/*', 'application/pdf'];
		expect(typeAllowed('image/png', allowed)).toBe(true);
		expect(typeAllowed('IMAGE/JPEG', allowed)).toBe(true);
		expect(typeAllowed('application/pdf', allowed)).toBe(true);
		expect(typeAllowed('text/plain; charset=utf-8', ['text/plain'])).toBe(true);
		expect(typeAllowed('video/mp4', allowed)).toBe(false);
		expect(typeAllowed('imagex/png', allowed)).toBe(false);
	});
});

describe('precheck', () => {
	it('ohne meta wird nichts abgelehnt', () => {
		const r = precheck([inp(f('a', 999 * MB))], null, 'personal');
		expect(r[0]!.problem).toBeNull();
	});

	it('Größe: genau Maximum erlaubt, ein Byte mehr abgelehnt', () => {
		const r = precheck([inp(f('ok', 10 * MB)), inp(f('gross', 10 * MB + 1))], meta(), 'shared');
		expect(r[0]!.problem).toBeNull();
		expect(r[1]!.problem).toMatch(/^Zu groß \(10 MB, max\. 10 MB\)$/);
	});

	it('Typ nur prüfen, wenn der Browser ihn kennt', () => {
		const m = meta({ allowedContentTypes: ['image/*'] });
		const r = precheck(
			[
				inp(f('a.png', 1, 'image/png')),
				inp(f('a.exe', 1, 'application/x-msdownload')),
				inp(f('x', 1))
			],
			m,
			'shared'
		);
		expect(r.map((x) => x.problem === null)).toEqual([true, false, true]);
		expect(r[1]!.problem).toContain('Dateityp nicht erlaubt');
	});

	it('Kontingent: ab der ersten Datei, die nicht passt, wird abgelehnt (nur personal)', () => {
		const m = meta({}, { usedBytes: 6 * MB, limitBytes: 10 * MB });
		const files = [inp(f('a', 3 * MB)), inp(f('b', 2 * MB)), inp(f('c', 1))];
		const r = precheck(files, m, 'personal');
		expect(r[0]!.problem).toBeNull();
		expect(r[1]!.problem).toContain('Kontingent');
		// auch die kleine Datei danach (ab dem Eintrag, der nicht mehr passt)
		expect(r[2]!.problem).toContain('Kontingent');
		// Stamm-Bereich: kein Kontingent
		expect(precheck(files, m, 'shared').every((x) => x.problem === null)).toBe(true);
	});

	it('Kontingent: genau passend erlaubt, wartende Bytes zählen mit', () => {
		const m = meta({}, { usedBytes: 6 * MB, limitBytes: 10 * MB });
		expect(precheck([inp(f('a', 4 * MB))], m, 'personal')[0]!.problem).toBeNull();
		expect(precheck([inp(f('a', 4 * MB))], m, 'personal', 1)[0]!.problem).toContain('Kontingent');
	});

	it('unbegrenztes Kontingent', () => {
		const m = meta({}, { usedBytes: 99 * MB, limitBytes: null });
		expect(precheck([inp(f('a', 5 * MB))], m, 'personal')[0]!.problem).toBeNull();
	});
});

describe('makeItems / pendingBytes', () => {
	it('abgelehnte als Fehler, Name aus relativem Pfad', () => {
		let n = 0;
		const items = makeItems(
			[
				{ ...inp(f('a.jpg', 5), 'Fotos/a.jpg'), problem: null },
				{ ...inp(f('b', 7)), problem: 'Zu groß' }
			],
			{ space: 'personal', parentId: null },
			() => `k${++n}`
		);
		expect(items[0]).toMatchObject({
			key: 'k1',
			name: 'Fotos/a.jpg',
			status: 'waiting',
			rejected: false
		});
		expect(items[1]).toMatchObject({
			key: 'k2',
			name: 'b',
			status: 'error',
			rejected: true,
			message: 'Zu groß'
		});
		expect(pendingBytes(items)).toBe(5);
	});
});

describe('queueProgress', () => {
	const it0 = { rejected: false, progress: 0 };
	it('leer → 0', () => {
		expect(queueProgress([]).fraction).toBe(0);
	});
	it('bytesbasiert, abgelehnte zählen nicht', () => {
		const p = queueProgress([
			{ ...it0, status: 'done', size: 100 },
			{ ...it0, status: 'uploading', size: 300, progress: 0.5 },
			{ ...it0, status: 'waiting', size: 600 },
			{ status: 'error', size: 1000, progress: 0, rejected: true }
		]);
		expect(p.totalBytes).toBe(1000);
		expect(p.loadedBytes).toBe(250);
		expect(p.fraction).toBeCloseTo(0.25);
		expect(p).toMatchObject({ done: 1, uploading: 1, waiting: 1, rejected: 1, busy: true });
	});
	it('Fehler zählen als abgearbeitet, Fortschritt geklemmt, leere Dateien bewegen den Balken', () => {
		const p = queueProgress([
			{ ...it0, status: 'error', size: 0 },
			{ ...it0, status: 'uploading', size: 0, progress: Number.NaN },
			{ ...it0, status: 'done', size: 0, progress: 5 }
		]);
		expect(p.fraction).toBeCloseTo(2 / 3);
		expect(p.busy).toBe(true);
	});
	it('nur abgelehnte → 1, nicht busy', () => {
		const p = queueProgress([{ status: 'error', size: 5, progress: 0, rejected: true }]);
		expect(p.fraction).toBe(1);
		expect(p.busy).toBe(false);
	});
});

describe('summaryToast', () => {
	it('Varianten', () => {
		expect(summaryToast({ ok: 1, failed: 0, rejected: 0 })).toEqual({
			kind: 'success',
			message: '1 Datei hochgeladen'
		});
		expect(summaryToast({ ok: 3, failed: 1, rejected: 2 })).toEqual({
			kind: 'warning',
			message: '3 Dateien hochgeladen, 1 fehlgeschlagen, 2 abgelehnt'
		});
		expect(summaryToast({ ok: 0, failed: 0, rejected: 1 })?.kind).toBe('error');
		expect(summaryToast({ ok: 0, failed: 0, rejected: 0 })).toBeNull();
	});
});

describe('uploadError', () => {
	it('Meldung vom Server, 413/422 abgelehnt', () => {
		expect(uploadError(413, { error: { code: 'too_large', message: 'Zu groß!' } })).toEqual({
			message: 'Zu groß!',
			rejected: true
		});
		expect(uploadError(422, null).rejected).toBe(true);
		expect(uploadError(500, { error: { message: '' } })).toEqual({
			message: 'Hochladen fehlgeschlagen',
			rejected: false
		});
		expect(uploadError(0, null).message).toContain('Netzwerkfehler');
		expect(uploadError(403, 'kaputt').rejected).toBe(false);
	});
});

// --- Ordner aus Drag & Drop ---

function fileEntry(file: FileLike): EntryLike {
	return {
		isFile: true,
		isDirectory: false,
		name: file.name,
		file: (ok: (f: FileLike) => void) => ok(file)
	} as EntryLike;
}
/** readEntries liefert seitenweise (hier je 2), dann leer */
function dirEntry(name: string, children: EntryLike[]): EntryLike {
	return {
		isFile: false,
		isDirectory: true,
		name,
		createReader() {
			let pos = 0;
			return {
				readEntries(ok: (e: EntryLike[]) => void) {
					const page = children.slice(pos, pos + 2);
					pos += page.length;
					setTimeout(() => ok(page), 0);
				}
			};
		}
	} as EntryLike;
}

describe('collectEntries', () => {
	it('rekursiv mit Pfad inkl. Wurzelordner, mehrere Seiten, leere Ordner ignoriert', async () => {
		const tree = dirEntry('Fotos', [
			fileEntry(f('a.jpg', 1)),
			dirEntry('2026', [
				fileEntry(f('b.jpg', 2)),
				fileEntry(f('c.jpg', 3)),
				fileEntry(f('d.jpg', 4))
			]),
			dirEntry('leer', []),
			fileEntry(f('e.jpg', 5))
		]);
		const out = await collectEntries<FileLike>([tree, fileEntry(f('lose.txt', 6))]);
		expect(out.map((o) => o.relativePath)).toEqual([
			'Fotos/a.jpg',
			'Fotos/2026/b.jpg',
			'Fotos/2026/c.jpg',
			'Fotos/2026/d.jpg',
			'Fotos/e.jpg',
			null
		]);
	});
	it('nicht lesbare Einträge werden übersprungen', async () => {
		const broken = {
			isFile: true,
			isDirectory: false,
			name: 'x',
			file: (_ok: unknown, err: (e: unknown) => void) => err(new Error('nope'))
		} as EntryLike;
		expect(await collectEntries([broken])).toEqual([]);
	});
});

describe('fromFileList', () => {
	it('webkitRelativePath als Pfad', () => {
		const r = fromFileList([
			{ ...f('a.jpg', 1), webkitRelativePath: 'Fotos/a.jpg' },
			{ ...f('b.jpg', 1), webkitRelativePath: '' }
		]);
		expect(r.map((x) => x.relativePath)).toEqual(['Fotos/a.jpg', null]);
	});
});
