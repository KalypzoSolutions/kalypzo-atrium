import { describe, expect, it } from 'vitest';
import {
	changelogBetween,
	computeUpdateStatus,
	defaultChannelFor,
	ignoreKey,
	pickReleaseTag,
	tagVersion
} from '../../src/lib/server/core/modules/install/update-rules';

const H1 = 'sha256-' + 'a'.repeat(64);
const H2 = 'sha256-' + 'b'.repeat(64);

describe('tagVersion / defaultChannelFor', () => {
	it('erkennt Repo- und Modul-Tags', () => {
		expect(tagVersion('v1.2.3')).toEqual({ version: '1.2.3', module: null });
		expect(tagVersion('1.2.3')).toEqual({ version: '1.2.3', module: null });
		expect(tagVersion('actions@1.9.0')).toEqual({ version: '1.9.0', module: 'actions' });
		expect(tagVersion('actions-v1.9.0')).toEqual({ version: '1.9.0', module: 'actions' });
		expect(tagVersion('ep-stamm@2.0.0-rc.1')).toEqual({
			version: '2.0.0-rc.1',
			module: 'ep-stamm'
		});
	});

	it('lehnt Branches und fremde Modul-Tags ab', () => {
		expect(tagVersion('main')).toBeNull();
		expect(tagVersion('feature/x')).toBeNull();
		expect(tagVersion('v1.2')).toBeNull();
		expect(tagVersion('notes@1.0.0', 'actions')).toBeNull();
		expect(tagVersion('v1.0.0', 'actions')).toEqual({ version: '1.0.0', module: null });
	});

	it('Standardkanal: Tag → release, sonst branch', () => {
		expect(defaultChannelFor('v1.0.0')).toBe('release');
		expect(defaultChannelFor('actions@1.0.0')).toBe('release');
		expect(defaultChannelFor('main')).toBe('branch');
		expect(defaultChannelFor('0123456789abcdef0123456789abcdef01234567')).toBe('branch');
		expect(defaultChannelFor(null)).toBe('branch');
	});
});

describe('pickReleaseTag', () => {
	const tags = [
		{ name: 'v1.0.0', sha: 'r1' },
		{ name: 'v2.0.0', sha: 'r2' },
		{ name: 'actions@1.8.0', sha: 'a18' },
		{ name: 'actions@1.10.0', sha: 'a110' },
		{ name: 'actions@1.11.0-beta.1', sha: 'a111b' },
		{ name: 'notes@9.0.0', sha: 'n9' },
		{ name: 'main', sha: 'm' }
	];

	it('nimmt eigene Modul-Tags vor Repo-Tags, semantisch sortiert (1.10 > 1.8)', () => {
		expect(pickReleaseTag(tags, 'actions', '1.8.0')).toEqual({
			name: 'actions@1.10.0',
			sha: 'a110',
			version: '1.10.0'
		});
	});

	it('ohne eigene Tags: höchster Repo-Tag', () => {
		expect(pickReleaseTag(tags, 'events', '1.0.0')?.name).toBe('v2.0.0');
	});

	it('Vorabversionen nur, wenn installiert selbst eine ist', () => {
		expect(pickReleaseTag(tags, 'actions', '1.11.0-alpha.1')?.name).toBe('actions@1.11.0-beta.1');
	});

	it('keine passenden Tags → null', () => {
		expect(pickReleaseTag([{ name: 'main', sha: 'x' }], 'actions', '1.0.0')).toBeNull();
		expect(pickReleaseTag([], 'actions', null)).toBeNull();
	});
});

describe('computeUpdateStatus', () => {
	const installed = { version: '1.2.0', contentHash: H1 };

	it('gleicher Inhalt → aktuell, auch bei neuem Commit im Repo', () => {
		expect(
			computeUpdateStatus({
				installed,
				latest: { version: '1.2.0', contentHash: H1 },
				ignored: null,
				blockers: []
			}).status
		).toBe('current');
	});

	it('höhere Version → update, gleiche Version mit anderem Inhalt → changed', () => {
		expect(
			computeUpdateStatus({
				installed,
				latest: { version: '1.3.0', contentHash: H2 },
				ignored: null,
				blockers: []
			}).status
		).toBe('update');
		expect(
			computeUpdateStatus({
				installed,
				latest: { version: '1.2.0', contentHash: H2 },
				ignored: null,
				blockers: []
			}).status
		).toBe('changed');
	});

	it('niedrigere Version → aktuell mit Hinweis „neuer installiert“', () => {
		expect(
			computeUpdateStatus({
				installed,
				latest: { version: '1.1.0', contentHash: H2 },
				ignored: null,
				blockers: []
			})
		).toEqual({ status: 'current', newerInstalled: true });
	});

	it('ignoriert genau diesen Stand; ein neuerer Stand erscheint wieder', () => {
		const latest = { version: '1.3.0', contentHash: H2 };
		expect(
			computeUpdateStatus({
				installed,
				latest,
				ignored: ignoreKey('1.3.0', H2),
				blockers: []
			}).status
		).toBe('ignored');
		expect(
			computeUpdateStatus({
				installed,
				latest: { version: '1.4.0', contentHash: H1.replace('a', 'c') },
				ignored: ignoreKey('1.3.0', H2),
				blockers: []
			}).status
		).toBe('update');
	});

	it('Sperren → incompatible; ohne neuen Stand → error', () => {
		expect(
			computeUpdateStatus({
				installed,
				latest: { version: '2.0.0', contentHash: H2 },
				ignored: null,
				blockers: ['Core zu alt']
			}).status
		).toBe('incompatible');
		expect(
			computeUpdateStatus({ installed, latest: null, ignored: null, blockers: [] }).status
		).toBe('error');
	});
});

describe('changelogBetween', () => {
	const md = [
		'# Änderungen',
		'',
		'## [1.4.0] – 2026-11-01',
		'- Neu: Export',
		'',
		'## 1.3.0',
		'- Fix: Liste',
		'### Intern',
		'- Aufgeräumt',
		'',
		'## v1.2.0',
		'- Alt',
		'',
		'## Unreleased stuff',
		'- egal'
	].join('\r\n');

	it('liefert die Abschnitte zwischen installiert (exklusiv) und neu (inklusiv), neueste zuerst', () => {
		const e = changelogBetween(md, '1.2.0', '1.4.0');
		expect(e.map((x) => x.version)).toEqual(['1.4.0', '1.3.0']);
		expect(e[0]!.notes).toBe('- Neu: Export');
		expect(e[1]!.notes).toContain('### Intern');
	});

	it('ohne installierte Version nur der Zielabschnitt; unbekannte Ziele → leer', () => {
		expect(changelogBetween(md, null, '1.3.0').map((x) => x.version)).toEqual(['1.3.0']);
		expect(changelogBetween(md, '1.0.0', 'kaputt')).toEqual([]);
		expect(changelogBetween('', '1.0.0', '2.0.0')).toEqual([]);
	});
});
