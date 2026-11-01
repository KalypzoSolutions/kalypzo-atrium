/**
 * Zugriff auf GitHub für die Modul-Installation: Ref → fester Commit (SHA), Archiv („zipball“) am SHA laden.
 * Nur `api.github.com` und `codeload.github.com` (keine frei wählbaren Hosts → kein SSRF), Weiterleitungen werden
 * einzeln geprüft. Optionales Token aus der Einstellung `core.modules.githubToken` (private Repos, höhere Limits).
 */
import { t } from '$lib/i18n';
import { errors } from '../../errors';
import { getSetting } from '../../settings/service';
import type { ModuleSource } from '../package/schema';
import { ARCHIVE_LIMITS } from './archive';

const ALLOWED_HOSTS = new Set(['api.github.com', 'codeload.github.com']);
const TIMEOUT_MS = 30_000;
const SHA_RE = /^[0-9a-f]{40}$/;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);

/** Nur für Tests: GitHub-Aufrufe umleiten (`null` = echtes `fetch`) */
export function setGithubFetchForTests(fn: FetchLike | null): void {
	fetchImpl = fn ?? ((url, init) => fetch(url, init));
}

async function headers(): Promise<Record<string, string>> {
	const token = String((await getSetting('core.modules.githubToken')) ?? '').trim();
	return {
		accept: 'application/vnd.github+json',
		'user-agent': 'kalypzo-atrium',
		'x-github-api-version': '2022-11-28',
		...(token ? { authorization: `Bearer ${token}` } : {})
	};
}

/** GET mit Host-Prüfung, eigener Weiterleitungsbehandlung (max. 3) und Zeitlimit */
async function get(url: string, accept?: string): Promise<Response> {
	let current = url;
	for (let hop = 0; hop < 4; hop++) {
		const u = new URL(current);
		if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
			throw errors.badRequest(t('install.github.unexpectedRedirect'));
		}
		const h = await headers();
		// Token nur an die API, nie an andere Hosts
		if (u.hostname !== 'api.github.com') delete h.authorization;
		if (accept) h.accept = accept;
		let res: Response;
		try {
			res = await fetchImpl(current, {
				headers: h,
				redirect: 'manual',
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch {
			throw errors.unavailable(t('install.github.unreachable'));
		}
		if (res.status >= 300 && res.status < 400) {
			const loc = res.headers.get('location');
			if (!loc) break;
			current = new URL(loc, current).toString();
			continue;
		}
		if (res.status === 403 || res.status === 429) {
			if (res.headers.get('x-ratelimit-remaining') === '0') {
				throw errors.unavailable(t('install.github.rateLimit'));
			}
		}
		return res;
	}
	throw errors.badRequest(t('install.github.tooManyRedirects'));
}

const api = (path: string) => `https://api.github.com${path}`;
const enc = encodeURIComponent;

/** Standard-Branch eines Repositorys */
async function defaultBranch(owner: string, repo: string): Promise<string> {
	const res = await get(api(`/repos/${enc(owner)}/${enc(repo)}`));
	if (res.status === 404) {
		throw errors.notFound(t('install.github.repoNotFound'));
	}
	if (!res.ok) throw errors.unavailable(t('install.github.status', { status: res.status }));
	const body = (await res.json()) as { default_branch?: string };
	if (!body.default_branch) throw errors.unavailable(t('install.github.noDefaultBranch'));
	return body.default_branch;
}

async function commitSha(owner: string, repo: string, ref: string): Promise<string | null> {
	const res = await get(api(`/repos/${enc(owner)}/${enc(repo)}/commits/${enc(ref)}`));
	if (res.status === 404 || res.status === 422) return null;
	if (!res.ok) throw errors.unavailable(t('install.github.status', { status: res.status }));
	const sha = String(((await res.json()) as { sha?: string }).sha ?? '');
	return SHA_RE.test(sha) ? sha : null;
}

/**
 * Ref (Branch, Tag, SHA oder leer = Standard-Branch) zum festen Commit auflösen. Bei URL-Angaben mit „/“
 * (`tree/feature/x/modules/tasks`) ist unklar, wo der Ref endet: vom längsten Präfix an wird geprüft, der Rest
 * ist der Pfad.
 */
export async function resolveGithubSource(
	source: ModuleSource,
	pathAfterRef: string[] = []
): Promise<{ owner: string; repo: string; ref: string; sha: string; path: string }> {
	const { owner, repo } = source;
	if (!source.ref) {
		const ref = await defaultBranch(owner, repo);
		const sha = await commitSha(owner, repo, ref);
		if (!sha) throw errors.notFound(t('install.github.branchNotFound', { ref }));
		return { owner, repo, ref, sha, path: source.path };
	}
	const segments = [source.ref, ...pathAfterRef];
	for (let i = segments.length; i >= 1; i--) {
		const ref = segments.slice(0, i).join('/');
		const sha = SHA_RE.test(ref) ? ref : await commitSha(owner, repo, ref);
		if (sha) {
			const rest = segments.slice(i).join('/');
			return { owner, repo, ref, sha, path: pathAfterRef.length ? rest : source.path };
		}
	}
	throw errors.notFound(t('install.github.refNotFound', { ref: source.ref }));
}

/** Archiv des Repositorys am Commit `sha` (ZIP), höchstens `ARCHIVE_LIMITS.maxArchiveBytes` */
export async function downloadGithubArchive(
	owner: string,
	repo: string,
	sha: string
): Promise<Uint8Array> {
	if (!SHA_RE.test(sha)) throw errors.badRequest(t('install.github.invalidCommit'));
	const res = await get(api(`/repos/${enc(owner)}/${enc(repo)}/zipball/${sha}`), '*/*');
	if (res.status === 404) throw errors.notFound(t('install.github.archiveNotFound'));
	if (!res.ok || !res.body)
		throw errors.unavailable(t('install.github.status', { status: res.status }));
	const declared = Number(res.headers.get('content-length') ?? '0');
	if (declared > ARCHIVE_LIMITS.maxArchiveBytes)
		throw errors.tooLarge(t('install.archive.tooLarge'));
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > ARCHIVE_LIMITS.maxArchiveBytes) {
			await reader.cancel();
			throw errors.tooLarge(t('install.archive.tooLarge'));
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let o = 0;
	for (const c of chunks) {
		out.set(c, o);
		o += c.byteLength;
	}
	return out;
}
