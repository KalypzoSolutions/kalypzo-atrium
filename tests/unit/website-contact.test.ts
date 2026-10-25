/**
 * Stammeswebsite (#31): Kontaktformular – Eingabeprüfung, Mail-Aufbau ohne Kopfzeilen-Injection und SMTP-Versand
 * gegen einen Test-Server (`website/src/lib/server/contact.ts`, `smtp.ts`, rein, nur Node-Bordmittel).
 */
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
	CONTACT_SUBJECT,
	HONEYPOT_FIELD,
	buildContactMessage,
	parseContactForm,
	parseTrialForm,
	trialAsContact
} from '../../website/src/lib/server/contact';
import { SmtpError, dotStuff, sendMail } from '../../website/src/lib/server/smtp';

function form(values: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(values)) f.set(k, v);
	return f;
}

const valid = {
	name: 'Erika Mustermann',
	email: 'erika@example.org',
	phone: '+49 421 123456',
	message: 'Hallo,\nwann ist die nächste Gruppenstunde?',
	consent: 'on'
};

describe('parseContactForm', () => {
	it('akzeptiert gültige Eingaben', () => {
		const r = parseContactForm(form(valid));
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.spam).toBe(false);
			expect(r.value.message).toContain('nächste');
		}
	});

	it('meldet fehlende Pflichtfelder, ungültige Adresse und fehlende Einwilligung', () => {
		const r = parseContactForm(
			form({ name: '', email: 'keine-adresse', message: '', phone: 'abc' })
		);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(Object.keys(r.errors).sort()).toEqual([
				'consent',
				'email',
				'message',
				'name',
				'phone'
			]);
	});

	it('lehnt Kopfzeilen in der E-Mail-Adresse ab und macht den Namen einzeilig', () => {
		const r = parseContactForm(
			form({ ...valid, email: 'a@example.org\r\nBcc: opfer@example.com' })
		);
		expect(r.ok).toBe(false);
		const n = parseContactForm(form({ ...valid, name: 'Erika\r\nBcc: opfer@example.com' }));
		expect(n.ok && n.value.name).toBe('Erika Bcc: opfer@example.com');
	});

	it('begrenzt die Länge der Nachricht', () => {
		const r = parseContactForm(form({ ...valid, message: 'x'.repeat(5001) }));
		expect(r.ok).toBe(false);
	});

	it('erkennt den Honeypot (auch mit sonst ungültigen Feldern) als Spam', () => {
		const r = parseContactForm(form({ [HONEYPOT_FIELD]: 'http://spam.example' }));
		expect(r.ok && r.spam).toBe(true);
	});
});

describe('buildContactMessage', () => {
	it('fester Empfänger und Betreff, Eingaben nur im Base64-Text und in Reply-To', () => {
		const parsed = parseContactForm(form({ ...valid, name: 'Erika\nTo: opfer@example.com' }));
		if (!parsed.ok) throw new Error('ungültig');
		const msg = buildContactMessage(parsed.value, {
			from: 'website@example.org',
			to: 'kontakt@example.org',
			date: new Date('2026-10-21T10:00:00Z')
		});
		const [head, body] = msg.split('\r\n\r\n');
		const headers = head!.split('\r\n');
		expect(headers.filter((h) => /^To:/i.test(h))).toEqual(['To: <kontakt@example.org>']);
		expect(headers).toContain('Reply-To: <erika@example.org>');
		expect(headers.some((h) => /^(Bcc|Cc):/i.test(h))).toBe(false);
		expect(head).not.toContain('Erika');
		const subject = headers.find((h) => h.startsWith('Subject: '))!.slice(9);
		const decoded = Buffer.from(subject.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString(
			'utf8'
		);
		expect(decoded).toBe(CONTACT_SUBJECT);
		const text = Buffer.from(body!.replace(/\r\n/g, ''), 'base64').toString('utf8');
		expect(text).toContain('Name: Erika To: opfer@example.com');
		expect(text).toContain('wann ist die nächste Gruppenstunde?');
		expect(body!.split('\r\n').every((l) => l.length <= 76)).toBe(true);
	});
});

describe('dotStuff', () => {
	it('verdoppelt Punkte am Zeilenanfang und normalisiert Zeilenenden', () => {
		expect(dotStuff('a\n.\n..b\r\nc')).toBe('a\r\n..\r\n...b\r\nc');
	});
});

// --- SMTP gegen einen Test-Server --------------------------------------------------------------

interface FakeServer {
	port: number;
	commands: string[];
	data: string[];
	close(): Promise<void>;
}

function fakeSmtp(options: { rejectRcpt?: boolean; auth?: boolean } = {}): Promise<FakeServer> {
	const commands: string[] = [];
	const data: string[] = [];
	const server = net.createServer((socket) => {
		let buffer = '';
		let inData = false;
		let current = '';
		socket.write('220 test ESMTP\r\n');
		socket.on('data', (chunk) => {
			buffer += chunk.toString('utf8');
			let i: number;
			while ((i = buffer.indexOf('\r\n')) >= 0) {
				const line = buffer.slice(0, i);
				buffer = buffer.slice(i + 2);
				if (inData) {
					if (line === '.') {
						inData = false;
						data.push(current);
						current = '';
						socket.write('250 OK queued\r\n');
					} else current += `${line}\r\n`;
					continue;
				}
				commands.push(line);
				if (/^EHLO/i.test(line)) {
					socket.write(
						`250-test\r\n${options.auth ? '250-AUTH PLAIN LOGIN\r\n' : ''}250 8BITMIME\r\n`
					);
				} else if (/^AUTH PLAIN/i.test(line)) socket.write('235 OK\r\n');
				else if (/^MAIL FROM/i.test(line)) socket.write('250 OK\r\n');
				else if (/^RCPT TO/i.test(line))
					socket.write(options.rejectRcpt ? '550 nein\r\n' : '250 OK\r\n');
				else if (line === 'DATA') {
					inData = true;
					socket.write('354 go\r\n');
				} else if (line === 'QUIT') {
					socket.write('221 bye\r\n');
					socket.end();
				} else socket.write('500 ?\r\n');
			}
		});
		socket.on('error', () => {});
	});
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const port = (server.address() as net.AddressInfo).port;
			resolve({
				port,
				commands,
				data,
				close: () => new Promise((r) => server.close(() => r()))
			});
		});
	});
}

describe('sendMail', () => {
	let server: FakeServer | null = null;
	afterEach(async () => {
		await server?.close();
		server = null;
	});

	it('stellt die Nachricht an die feste Adresse zu (Umschlag aus der Konfiguration)', async () => {
		server = await fakeSmtp();
		await sendMail(
			{ host: '127.0.0.1', port: server.port, secure: false, timeoutMs: 3000 },
			{ from: 'website@example.org', to: ['kontakt@example.org'] },
			'Subject: Test\r\n\r\n.Zeile mit Punkt\r\nEnde'
		);
		expect(server.commands).toEqual([
			'EHLO localhost',
			'MAIL FROM:<website@example.org>',
			'RCPT TO:<kontakt@example.org>',
			'DATA',
			'QUIT'
		]);
		expect(server.data[0]).toBe('Subject: Test\r\n\r\n..Zeile mit Punkt\r\nEnde\r\n');
	});

	it('meldet abgelehnte Empfänger als SmtpError', async () => {
		server = await fakeSmtp({ rejectRcpt: true });
		await expect(
			sendMail(
				{ host: '127.0.0.1', port: server.port, secure: false, timeoutMs: 3000 },
				{ from: 'website@example.org', to: ['kontakt@example.org'] },
				'Subject: x\r\n\r\ny'
			)
		).rejects.toBeInstanceOf(SmtpError);
	});

	it('meldet sich ohne TLS nicht an (Zugangsdaten nie im Klartext)', async () => {
		server = await fakeSmtp({ auth: true });
		await expect(
			sendMail(
				{
					host: '127.0.0.1',
					port: server.port,
					secure: false,
					user: 'u',
					pass: 'geheim',
					timeoutMs: 3000
				},
				{ from: 'website@example.org', to: ['kontakt@example.org'] },
				'Subject: x\r\n\r\ny'
			)
		).rejects.toThrow(/Klartext/);
		expect(server.commands.some((c) => c.startsWith('AUTH'))).toBe(false);
	});

	it('lehnt ungültige Adressen in der Konfiguration ab, ohne zu verbinden', async () => {
		await expect(
			sendMail(
				{ host: '127.0.0.1', port: 1, secure: false },
				{ from: 'website@example.org', to: ['a@b.org>\r\nRCPT TO:<x@y.org'] },
				'x'
			)
		).rejects.toBeInstanceOf(SmtpError);
	});
});

describe('Probestunden-Formular', () => {
	const ok = {
		childName: ' Mia  Muster ',
		childAge: '8',
		name: 'Petra Muster',
		email: 'petra@example.org',
		phone: '0421 123456',
		message: 'Hallo',
		group: 'fuechse',
		consent: 'on'
	};
	it('übernimmt gültige Eingaben, Gruppe nur wenn bekannt', () => {
		const r = parseTrialForm(form(ok), ['fuechse']);
		expect(r).toMatchObject({
			ok: true,
			spam: false,
			value: { childName: 'Mia Muster', childAge: 8, groupSlug: 'fuechse' }
		});
		const unknown = parseTrialForm(form(ok), ['adler']);
		expect(unknown.ok && unknown.value.groupSlug).toBe('');
	});
	it('meldet Pflichtfelder und ungültiges Alter', () => {
		const r = parseTrialForm(form({ ...ok, childName: '', childAge: '2', phone: '', consent: '' }));
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(Object.keys(r.errors).sort()).toEqual(['childAge', 'childName', 'consent', 'phone']);
		}
		const text = parseTrialForm(form({ ...ok, childAge: 'acht' }));
		expect(!text.ok && text.errors.childAge).toBeTruthy();
	});
	it('Honeypot wie Erfolg; SMTP-Rückfall enthält Kind und Alter', () => {
		expect(parseTrialForm(form({ [HONEYPOT_FIELD]: 'x' }))).toMatchObject({ ok: true, spam: true });
		const r = parseTrialForm(form(ok), ['fuechse']);
		if (!r.ok) throw new Error('ungültig');
		expect(trialAsContact(r.value, 'Meute Füchse').message).toContain(
			'Kind: Mia Muster\nAlter: 8 Jahre\nGruppe: Meute Füchse'
		);
	});
});
