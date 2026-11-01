// E2E der Modul-Installation (Kalypzo Atrium, Phase 6): PGlite im Speicher + Supervisor mit einem kleinen Basis-Build
// (nur Fixture-Modul fx-people). Die Specs in tests/e2e-install installieren weitere Fixtures über das Panel; der
// Supervisor baut dann wirklich neu und startet die App neu. Port 4174, Daten in .data/e2e-install (bei jedem Start neu).
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Supervisor } from './supervisor/lib.mjs';

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(coreRoot, '.data', 'e2e-install');
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

// Basis: nur fx-people
const baseModules = join(dataDir, 'base-modules');
cpSync(
	join(coreRoot, 'tests', 'fixtures', 'modules', 'fx-people'),
	join(baseModules, 'fx-people'),
	{
		recursive: true
	}
);
const baseBuild = join(dataDir, 'base-build');
const buildEnv = {
	...process.env,
	ATRIUM_MODULES_DIR: baseModules,
	ATRIUM_BUILD_OUT: baseBuild,
	ATRIUM_KIT_OUT_DIR: join(dataDir, 'base-kit'),
	ATRIUM_VITE_CACHE: join(dataDir, 'cache', 'vite')
};
for (const args of [
	[join(coreRoot, 'node_modules', '@sveltejs', 'kit', 'svelte-kit.js'), 'sync'],
	[join(coreRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']
]) {
	const r = spawnSync(process.execPath, args, { cwd: coreRoot, env: buildEnv, stdio: 'inherit' });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

const { PGlite } = await import('@electric-sql/pglite');
const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, port: 54331, host: '127.0.0.1', maxConnections: 10 });
await server.start();

const supervisor = new Supervisor({
	coreRoot,
	dataDir: join(dataDir, 'atrium'),
	baseModulesDir: baseModules,
	baseBuildDir: baseBuild,
	healthTimeoutMs: 180_000,
	env: {
		DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:54331/postgres?sslmode=disable',
		APP_SECRET: 'e2e-install-secret-e2e-install-secret-1',
		ORIGIN: 'http://localhost:4174',
		INITIAL_ADMIN_EMAIL: 'admin@example.test',
		INITIAL_ADMIN_PASSWORD: 'e2e-admin-password-1',
		DATABASE_POOL_MAX: '1',
		AUTH_RATE_LIMIT_FACTOR: '50',
		PORT: '4174',
		HOST: '127.0.0.1',
		TZ: 'UTC',
		ATRIUM_MODULE_INSTALL: 'supervisor'
	}
});
const stop = async () => {
	await supervisor.stop();
	await server.stop();
	await db.close();
	process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await supervisor.start();
