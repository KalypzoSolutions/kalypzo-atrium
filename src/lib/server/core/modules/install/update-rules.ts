/**
 * Reine Regeln der Update-Prüfung (ohne Datenbank/Netz, in Unit-Tests direkt prüfbar):
 * - Kanal je Modul: `release` (nur Versionen mit Tag) oder `branch` (Kopf des gespeicherten Branches),
 * - passenden Release-Tag wählen (Modul-Tags `<id>@1.2.3` / `<id>-v1.2.3` vor Repo-Tags `v1.2.3`),
 * - Status aus installiertem und neuestem Stand (Inhaltshash + Version statt Commit),
 * - Änderungsnotizen aus `CHANGELOG.md` zwischen zwei Versionen.
 */
import semver from 'semver';

export type UpdateChannel = 'release' | 'branch';
export const UPDATE_CHANNELS: readonly UpdateChannel[] = ['release', 'branch'];

/** `unchecked` = Quelle vorhanden, aber noch nie geprüft */
export type UpdateStatus =
	| 'current'
	| 'unchecked'
	| 'update'
	| 'changed'
	| 'incompatible'
	| 'ignored'
	| 'no-source'
	| 'error';

/** Ref, das wie ein Versions-Tag aussieht (`v1.2.3`, `1.2.3`, `<id>@1.2.3`, `<id>-v1.2.3`) */
const TAG_VERSION =
	/^(?:(?<id>[a-z][a-z0-9-]*)(?:@|-v|\/v))?v?(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** Version aus einem Tag lesen; `forModule` gesetzt → nur Tags dieses Moduls bzw. Repo-Tags ohne Modul */
export function tagVersion(
	tag: string,
	forModule?: string
): { version: string; module: string | null } | null {
	const m = TAG_VERSION.exec(tag.trim());
	if (!m?.groups) return null;
	const module = m.groups.id ?? null;
	const version = semver.valid(m.groups.version ?? '');
	if (!version) return null;
	if (forModule && module && module !== forModule) return null;
	return { version, module };
}

/** Standardkanal bei der Installation: über einen Versions-Tag installiert → Releases, sonst Branch */
export function defaultChannelFor(ref: string | null | undefined): UpdateChannel {
	return ref && tagVersion(ref) ? 'release' : 'branch';
}

export function normalizeChannel(v: unknown): UpdateChannel {
	return v === 'release' ? 'release' : 'branch';
}

export interface TagRef {
	name: string;
	sha: string;
}

/**
 * Höchster Release-Tag für ein Modul. Gibt es Tags des Moduls (`<id>@…`, `<id>-v…`), zählen nur sie (Monorepo mit
 * eigenen Versionen je Modul), sonst Repo-Tags (`v1.2.3`). Vorabversionen nur, wenn die installierte selbst eine ist.
 */
export function pickReleaseTag(
	tags: TagRef[],
	moduleId: string,
	installedVersion: string | null
): (TagRef & { version: string }) | null {
	const allowPre = !!(installedVersion && semver.prerelease(installedVersion));
	const parsed = tags
		.map((t) => ({ ...t, parsed: tagVersion(t.name, moduleId) }))
		.filter(
			(t): t is TagRef & { parsed: { version: string; module: string | null } } =>
				!!t.parsed && (allowPre || !semver.prerelease(t.parsed.version))
		);
	const own = parsed.filter((t) => t.parsed.module === moduleId);
	const pool = own.length ? own : parsed.filter((t) => t.parsed.module === null);
	let best: (TagRef & { version: string }) | null = null;
	for (const t of pool) {
		if (!best || semver.gt(t.parsed.version, best.version)) {
			best = { name: t.name, sha: t.sha, version: t.parsed.version };
		}
	}
	return best;
}

/** Kennung eines Stands für „Diese Version ignorieren“ (Version + Inhalt) */
export function ignoreKey(version: string, contentHash: string): string {
	return `${version}#${contentHash.slice(0, 19)}`;
}

/**
 * Status aus installiertem und neuestem Stand. `blockers` = Gründe, warum der neue Stand nicht installiert werden
 * kann (Core-Version, Migrationen …); sie zählen nur, wenn es überhaupt etwas Neues gibt.
 */
export function computeUpdateStatus(input: {
	installed: { version: string; contentHash: string };
	latest: { version: string; contentHash: string } | null;
	ignored: string | null;
	blockers: string[];
}): { status: UpdateStatus; newerInstalled: boolean } {
	const { installed, latest } = input;
	if (!latest) return { status: 'error', newerInstalled: false };
	if (latest.contentHash === installed.contentHash)
		return { status: 'current', newerInstalled: false };
	const cmp =
		semver.valid(latest.version) && semver.valid(installed.version)
			? semver.compare(latest.version, installed.version)
			: latest.version === installed.version
				? 0
				: 1;
	// Installiert ist schon Neueres (z. B. Branch-Stand, Kanal danach auf Releases gestellt)
	if (cmp < 0) return { status: 'current', newerInstalled: true };
	if (input.ignored && input.ignored === ignoreKey(latest.version, latest.contentHash)) {
		return { status: 'ignored', newerInstalled: false };
	}
	if (input.blockers.length) return { status: 'incompatible', newerInstalled: false };
	return { status: cmp > 0 ? 'update' : 'changed', newerInstalled: false };
}

export interface ChangelogEntry {
	version: string;
	/** Text unter der Überschrift (Markdown, gekürzt) */
	notes: string;
}

const CHANGELOG_HEADING = /^##\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\s.*)?$/;
const NOTES_MAX = 2000;

/**
 * Abschnitte `## 1.2.3` / `## [1.2.3] – Datum` aus einer `CHANGELOG.md`, deren Version in `(from, to]` liegt,
 * neueste zuerst, höchstens 10. Ohne `from` (Neuinstallation) nur der Abschnitt `to`.
 */
export function changelogBetween(text: string, from: string | null, to: string): ChangelogEntry[] {
	const entries: ChangelogEntry[] = [];
	let current: { version: string; lines: string[] } | null = null;
	const flush = () => {
		if (current) {
			entries.push({
				version: current.version,
				notes: current.lines.join('\n').trim().slice(0, NOTES_MAX)
			});
		}
	};
	for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
		const m = CHANGELOG_HEADING.exec(line.trim());
		if (m) {
			flush();
			current = semver.valid(m[1]!) ? { version: semver.valid(m[1]!)!, lines: [] } : null;
		} else if (/^#\s/.test(line.trim())) {
			flush();
			current = null;
		} else current?.lines.push(line);
	}
	flush();
	const target = semver.valid(to);
	const base = from ? semver.valid(from) : null;
	if (!target) return [];
	return entries
		.filter((e) =>
			base ? semver.gt(e.version, base) && semver.lte(e.version, target) : e.version === target
		)
		.sort((a, b) => semver.rcompare(a.version, b.version))
		.slice(0, 10);
}
