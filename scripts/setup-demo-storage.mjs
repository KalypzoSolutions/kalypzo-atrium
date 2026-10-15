// Hinterlegt die Demo-MinIO-Verbindung (docker-compose.demo.yml) in den Systemeinstellungen des
// laufenden Demo-Servers (http://localhost:4300). Idempotent.
const BASE = 'http://127.0.0.1:4300';
const headers = { origin: 'http://localhost:4300', 'content-type': 'application/json' };

const login = await fetch(`${BASE}/api/auth/sign-in/email`, {
	method: 'POST',
	headers,
	body: JSON.stringify({ email: 'admin@demo.test', password: 'Demo-Admin-2026!' })
});
if (!login.ok) throw new Error(`Login fehlgeschlagen (${login.status})`);
const cookie = login.headers
	.getSetCookie()
	.map((c) => c.split(';')[0])
	.join('; ');

const values = {
	'core.storage.endpoint': 'http://127.0.0.1:9100',
	'core.storage.region': 'us-east-1',
	'core.storage.bucket': 'ep-intern-demo',
	'core.storage.accessKeyId': 'demo-access',
	'core.storage.secretAccessKey': 'demo-secret-key-2026',
	'core.storage.forcePathStyle': true
};
const res = await fetch(`${BASE}/api/v1/settings`, {
	method: 'PUT',
	headers: { ...headers, cookie },
	body: JSON.stringify({ values })
});
console.log('Einstellungen speichern:', res.status, res.ok ? 'ok' : await res.text());
