// Hinterlegt Mailpit (docker-compose.demo.yml, SMTP 127.0.0.1:1026) als SMTP-Server im laufenden
// Demo-System (http://localhost:4300). Gesendete Mails erscheinen unter http://localhost:8026. Idempotent.
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
	'core.smtp.host': '127.0.0.1',
	'core.smtp.port': 1026,
	'core.smtp.secure': false,
	'core.smtp.user': '',
	'core.smtp.from': 'noreply@demo.test'
};
const res = await fetch(`${BASE}/api/v1/settings`, {
	method: 'PUT',
	headers: { ...headers, cookie },
	body: JSON.stringify({ values })
});
console.log('SMTP-Einstellungen speichern:', res.status, res.ok ? 'ok' : await res.text());
