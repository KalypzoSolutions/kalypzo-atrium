// Demo-Start ohne Docker: persistente PGlite-Datenbank (.data/pglite) per TCP-Socket + gebaute App.
// Voraussetzung: `npm run build`. Start: `node scripts/demo-server.mjs`, Seed: `node scripts/seed-demo.mjs`.
// Die App läuft unter dem Supervisor (Kalypzo Atrium): Module lassen sich im Panel installieren, der Supervisor baut
// dann neu (Generationen in .data/atrium) und startet die App neu – PGlite bleibt dabei in diesem Prozess offen.
import { existsSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Supervisor } from './supervisor/lib.mjs';

const { PGlite } = await import('@electric-sql/pglite');
const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
const db = await PGlite.create('./.data/pglite');
const server = new PGLiteSocketServer({ db, port: 54330, host: '127.0.0.1', maxConnections: 10 });
await server.start();

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const supervisor = new Supervisor({
	coreRoot,
	dataDir: process.env.ATRIUM_DATA_DIR?.trim() || join(coreRoot, '.data', 'atrium'),
	env: {
		DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:54330/postgres?sslmode=disable',
		APP_SECRET: 'demo-secret-demo-secret-demo-secret-demo-1234',
		ORIGIN: 'http://localhost:4300',
		INITIAL_ADMIN_EMAIL: 'admin@demo.test',
		INITIAL_ADMIN_PASSWORD: 'Demo-Admin-2026!',
		// PGlite hat nur eine Sitzung: parallele Transaktionen würden sich sonst vermischen
		DATABASE_POOL_MAX: '1',
		PORT: '4300',
		HOST: '127.0.0.1',
		ATRIUM_MODULE_INSTALL: process.env.ATRIUM_MODULE_INSTALL ?? 'supervisor'
	}
});

let stopping = false;
const stop = async (code) => {
	if (stopping) return;
	stopping = true;
	await supervisor.stop();
	await server.stop();
	await db.close();
	process.exit(code ?? 0);
};
// Windows kann keine Signale an Kindprozesse senden: Wer die Datei `.data/stop` anlegt, beendet den
// Server sauber (verhindert eine beschädigte PGlite-Datenbank durch hartes Beenden).
const stopFile = './.data/stop';
setInterval(() => {
	if (existsSync(stopFile)) {
		try {
			unlinkSync(stopFile);
		} catch {
			// ignorieren
		}
		void stop(0);
	}
}, 500).unref();
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
await supervisor.start();
