// Startpunkt im Container (Kalypzo Atrium, Phase 6): `node scripts/supervisor.mjs` statt `node build`.
// Datenverzeichnis über ATRIUM_DATA_DIR (Volume, Standard ./.data/atrium), Port über PORT.
// Beenden: SIGTERM/SIGINT → App geordnet beenden (IPC), dann Supervisor.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Supervisor } from './supervisor/lib.mjs';

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const supervisor = new Supervisor({
	coreRoot,
	dataDir: process.env.ATRIUM_DATA_DIR?.trim() || join(coreRoot, '.data', 'atrium')
});

let stopping = false;
const stop = async () => {
	if (stopping) return;
	stopping = true;
	await supervisor.stop();
	process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
await supervisor.start();
