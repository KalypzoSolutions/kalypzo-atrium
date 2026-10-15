import nodemailer from 'nodemailer';
import { errors } from './errors';
import { getSettings } from './settings/service';

export interface MailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

export interface MailTransport {
	sendMail(msg: {
		from: string;
		to: string;
		subject: string;
		text: string;
		html?: string;
	}): Promise<unknown>;
}

let testTransport: MailTransport | undefined;
/** Fuer Tests: ersetzt SMTP durch einen Testadapter. */
export function setMailTransportForTests(t: MailTransport | undefined): void {
	testTransport = t;
}

async function transport(): Promise<{ t: MailTransport; from: string }> {
	const s = await getSettings([
		'core.smtp.host',
		'core.smtp.port',
		'core.smtp.secure',
		'core.smtp.user',
		'core.smtp.password',
		'core.smtp.from'
	]);
	const from = String(s['core.smtp.from'] || '');
	if (testTransport) return { t: testTransport, from: from || 'test@example.invalid' };
	const host = String(s['core.smtp.host'] || '');
	if (!host || !from) throw errors.unavailable('SMTP ist nicht konfiguriert');
	const user = String(s['core.smtp.user'] || '');
	const t = nodemailer.createTransport({
		host,
		port: Number(s['core.smtp.port']),
		secure: Boolean(s['core.smtp.secure']),
		auth: user ? { user, pass: String(s['core.smtp.password'] || '') } : undefined
	});
	return { t, from };
}

export async function sendMail(msg: MailMessage): Promise<void> {
	const { t, from } = await transport();
	await t.sendMail({ from, ...msg });
}
