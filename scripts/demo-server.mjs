// Demo-Start ohne Docker: persistente PGlite-Datenbank (.data/pglite) per TCP-Socket + gebaute App.
// Voraussetzung: `npm run build`. Start: `node scripts/demo-server.mjs`, Seed: `node scripts/seed-demo.mjs`.
import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';

const { PGlite } = await import('@electric-sql/pglite');
const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
const db = await PGlite.create('./.data/pglite');
const server = new PGLiteSocketServer({ db, port: 54330, host: '127.0.0.1', maxConnections: 10 });
await server.start();

const env = {
	...process.env,
	DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:54330/postgres?sslmode=disable',
	APP_SECRET: 'demo-secret-demo-secret-demo-secret-demo-1234',
	ORIGIN: 'http://localhost:4300',
	INITIAL_ADMIN_EMAIL: 'admin@demo.test',
	INITIAL_ADMIN_PASSWORD: 'Demo-Admin-2026!',
	// PGlite hat nur eine Sitzung: parallele Transaktionen würden sich sonst vermischen
	DATABASE_POOL_MAX: '1',
	PORT: '4300',
	HOST: '127.0.0.1'
};
const child = spawn(process.execPath, ['build'], { env, stdio: 'inherit' });
const stop = async (code) => {
	child.kill();
	await server.stop();
	await db.close();
	process.exit(code ?? 0);
};
child.on('exit', (code) => stop(code ?? 1));
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
