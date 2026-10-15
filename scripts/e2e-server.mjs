// Startet fuer E2E-Tests eine In-Memory-PostgreSQL-Instanz (PGlite ueber TCP-Socket)
// und die gebaute App dagegen. Es ist kein Docker noetig.
// Mit E2E_DATABASE_URL kann stattdessen eine echte PostgreSQL-Datenbank verwendet werden.
import { spawn } from 'node:child_process';

let databaseUrl = process.env.E2E_DATABASE_URL;
let closeDb = async () => {};

if (!databaseUrl) {
	const { PGlite } = await import('@electric-sql/pglite');
	const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
	const db = await PGlite.create();
	const server = new PGLiteSocketServer({ db, port: 54329, host: '127.0.0.1', maxConnections: 10 });
	await server.start();
	databaseUrl = 'postgres://postgres:postgres@127.0.0.1:54329/postgres?sslmode=disable';
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
	// PGlite hat nur eine Sitzung (nur bei echter PostgreSQL ueber E2E_DATABASE_URL mehrere)
	...(process.env.E2E_DATABASE_URL ? {} : { DATABASE_POOL_MAX: '1' }),
	PORT: '4173',
	HOST: '127.0.0.1'
};
const child = spawn(process.execPath, ['build'], { env, stdio: 'inherit' });
const stop = async (code) => {
	child.kill();
	await closeDb();
	process.exit(code ?? 0);
};
child.on('exit', (code) => stop(code ?? 1));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
