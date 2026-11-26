// Startet für E2E-Tests eine In-Memory-PostgreSQL-Instanz (PGlite über TCP-Socket)
// und die gebaute App dagegen. Es ist kein Docker nötig.
// Mit E2E_DATABASE_URL kann stattdessen eine echte PostgreSQL-Datenbank verwendet werden.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

let databaseUrl = process.env.E2E_DATABASE_URL;
let closeDb = async () => {};
let fixtureDb;

if (!databaseUrl) {
	const { PGlite } = await import('@electric-sql/pglite');
	const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
	const db = await PGlite.create();
	fixtureDb = db;
	// Port änderbar: Windows/Hyper-V reserviert nach dem Docker-Start oft Bereiche um 54300 (EACCES)
	const port = Number(process.env.E2E_PGLITE_PORT ?? 54329);
	const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
	await server.start();
	databaseUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
	closeDb = async () => {
		await server.stop();
		await db.close();
	};
}

const env = {
	...process.env,
	DATABASE_URL: databaseUrl,
	APP_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
	ORIGIN: 'http://localhost:4173',
	INITIAL_ADMIN_EMAIL: 'admin@example.test',
	INITIAL_ADMIN_PASSWORD: 'e2e-admin-password-1',
	// PGlite hat nur eine Sitzung (nur bei echter PostgreSQL über E2E_DATABASE_URL mehrere)
	...(process.env.E2E_DATABASE_URL ? {} : { DATABASE_POOL_MAX: '1' }),
	// Alle Specs melden sich von 127.0.0.1 an – Auth-Rate-Limits (#14) entsprechend anheben
	AUTH_RATE_LIMIT_FACTOR: '50',
	// Kein Netzaufruf zum Modul-Marktplatz der Website (Job und Modulverwaltung zeigen „nicht erreichbar“)
	ATRIUM_MARKETPLACE_OFFLINE: '1',
	PORT: '4173',
	HOST: '127.0.0.1'
};
// `build/index.js` statt `build`: unter Bun wäre `bun build` der Bundler
const child = spawn(process.execPath, ['build/index.js'], { env, stdio: 'inherit' });
// Nur die lokale E2E-Datenbank erhält eine gespeicherte Registry; externe Abrufe bleiben deaktiviert.
if (fixtureDb) {
	const fixture = await readFile(
		new URL('../tests/fixtures/marketplace/index.json', import.meta.url),
		'utf8'
	);
	const seed = async () => {
		for (let attempt = 0; attempt < 120; attempt++) {
			try {
				// Erst nach den Migrationen schreiben, sonst stört die Abfrage deren Transaktion.
				const ready = await fetch('http://127.0.0.1:4173/api/v1/health');
				if (!ready.ok) throw new Error('Server nicht bereit');
				await fixtureDb.query(
					'INSERT INTO marketplace_cache (url, data, fetched_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (url) DO NOTHING',
					['https://fixture.example.test/marketplace.json', fixture]
				);
				return;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		}
		console.error('E2E-Marktplatz-Fixture konnte nicht gespeichert werden');
	};
	void seed();
}
const stop = async (code) => {
	child.kill();
	await closeDb();
	process.exit(code ?? 0);
};
child.on('exit', (code) => stop(code ?? 1));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
