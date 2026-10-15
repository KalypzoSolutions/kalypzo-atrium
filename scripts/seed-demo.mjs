// Legt Demo-Daten ueber die echte API an (idempotent). Voraussetzung: demo-server laeuft.
const BASE = 'http://localhost:4300';
const ORIGIN = 'http://localhost:4300';
const PW = 'Demo-Passwort-2026!';

let cookie = '';
async function call(method, path, body, base = '/api/v1') {
	const res = await fetch(BASE + base + path, {
		method,
		headers: {
			'content-type': 'application/json',
			origin: ORIGIN,
			...(cookie ? { cookie } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const set = res.headers.getSetCookie?.() ?? [];
	if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
	const json = await res.json().catch(() => null);
	return { status: res.status, json };
}

await call(
	'POST',
	'/sign-in/email',
	{ email: 'admin@demo.test', password: 'Demo-Admin-2026!' },
	'/api/auth'
);
if (!cookie) throw new Error('Login fehlgeschlagen - laeuft der Demo-Server?');

// Einstellungen
await call('PUT', '/settings', {
	values: {
		'core.system.name': 'EP Intern Demo',
		'core.organization.name': 'Beispiel Verein e. V.',
		'core.organization.address': 'Musterstrasse 1\n12345 Musterstadt',
		'core.organization.email': 'kontakt@beispiel-verein.test',
		'core.organization.phone': '+49 123 456789',
		'core.design.accentColor': '#0f766e',
		'core.smtp.host': 'smtp.beispiel.test',
		'core.smtp.port': 587,
		'core.smtp.from': 'noreply@beispiel-verein.test',
		'core.pdf.headerText': 'Beispiel Verein e. V.',
		'core.pdf.footerText': 'Vertraulich - nur zur internen Verwendung',
		'core.ai.defaultModel': 'gpt-4o-mini',
		'core.ai.monthlyTokenLimit': 1000000,
		'core.storage.bucket': 'demo-bucket',
		'core.storage.endpoint': 'http://localhost:9000',
		'core.storage.forcePathStyle': true
	}
});

// Berechtigungen -> Rollen
const perms = (await call('GET', '/permissions')).json.data.map((p) => p.key);
const pick = (...prefixes) => perms.filter((k) => prefixes.some((p) => k.startsWith(p)));
const roleDefs = [
	{
		name: 'Benutzerverwaltung',
		description: 'Benutzer ansehen, anlegen und bearbeiten',
		permissions: [
			'core.users.view',
			'core.users.create',
			'core.users.edit',
			'core.roles.view',
			'core.roles.assign'
		]
	},
	{
		name: 'Auditor',
		description: 'Nur lesender Zugriff auf Logs und Benutzer',
		permissions: ['core.audit.view', 'core.users.view', 'core.roles.view', 'core.modules.view']
	},
	{
		name: 'Redaktion',
		description: 'PDF und KI nutzen',
		permissions: ['core.pdf.generate', 'core.ai.use', 'core.ai.view']
	},
	{
		name: 'Systembetreuung',
		description: 'Einstellungen, Storage und API-Keys',
		permissions: [
			...pick('core.settings', 'core.storage', 'core.pdf', 'core.api'),
			'core.modules.view',
			'core.modules.manage'
		]
	}
];
const existingRoles = (await call('GET', '/roles')).json.data;
const roleIds = {};
for (const r of roleDefs) {
	const found = existingRoles.find((x) => x.name === r.name);
	if (found) roleIds[r.name] = found.id;
	else roleIds[r.name] = (await call('POST', '/roles', r)).json?.data?.id;
}

// Benutzer
const users = [
	['Anna Beispiel', 'anna@demo.test', ['Benutzerverwaltung']],
	['Bernd Prüfer', 'bernd@demo.test', ['Auditor']],
	['Clara Schreiber', 'clara@demo.test', ['Redaktion']],
	['Dieter Technik', 'dieter@demo.test', ['Systembetreuung']],
	['Eva Gast', 'eva@demo.test', []],
	['Frank Ehemalig', 'frank@demo.test', ['Auditor']]
];
for (const [name, email, roles] of users) {
	const r = await call('POST', '/users', {
		name,
		email,
		password: PW,
		roleIds: roles.map((n) => roleIds[n]).filter(Boolean)
	});
	if (email === 'frank@demo.test' && r.status === 201) {
		await call('PATCH', `/users/${r.json.data.id}`, { active: false });
	}
}

// API-Keys (Klartext wird nur hier ausgegeben)
const keys = (await call('GET', '/api-keys')).json.data;
const out = [];
for (const [name, scopes] of [
	['Reporting (lesend)', ['core.users.view', 'core.audit.view']],
	['PDF-Export', ['core.pdf.generate']]
]) {
	if (keys.some((k) => k.name === name)) continue;
	const r = await call('POST', '/api-keys', {
		name,
		scopes,
		expiresAt: new Date(Date.now() + 90 * 864e5).toISOString()
	});
	if (r.status === 201) out.push(`${name}: ${r.json.data.key}`);
}
// Etwas API-Verkehr fuer Zugriffsprotokoll und Audit
const k = out[0]?.split(': ')[1];
if (k)
	for (let i = 0; i < 5; i++)
		await fetch(BASE + '/api/v1/users', { headers: { authorization: `Bearer ${k}` } });

console.log('Seed abgeschlossen.');
if (out.length) console.log('Neue API-Keys:\n  ' + out.join('\n  '));
