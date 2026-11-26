/**
 * Standard-Zeitlimit für Hooks (`beforeAll`/`afterAll`/`beforeEach`/`afterEach`) in `bun test`.
 *
 * `[test] timeout` aus `bunfig.toml` gilt nur für Tests, Hooks bleiben bei 5 s. PGlite-Setups mit allen
 * Core-Migrationen brauchen unter `--parallel` länger (früher Vitest `hookTimeout: 60000`). Ein ausdrücklich
 * übergebenes Limit gewinnt.
 */
import * as real from 'bun:test';
import { mock } from 'bun:test';

const HOOK_TIMEOUT_MS = 60_000;

type Hook = (fn: () => unknown, timeout?: number) => void;
const withDefault =
	(hook: Hook): Hook =>
	(fn, timeout) =>
		hook(fn, timeout ?? HOOK_TIMEOUT_MS);

mock.module('bun:test', () => ({
	...real,
	beforeAll: withDefault(real.beforeAll as Hook),
	afterAll: withDefault(real.afterAll as Hook),
	beforeEach: withDefault(real.beforeEach as Hook),
	afterEach: withDefault(real.afterEach as Hook)
}));
