/**
 * #24 Mailversand: gepoolter, zwischengespeicherter Transport mit Zeitgrenzen.
 * - Transport wird nur einmal erzeugt (`pool: true`, Timeouts) und beim Speichern der SMTP-Einstellungen verworfen
 * - Hängender Transport → 503 nach der Obergrenze statt endlosem Warten
 * - Echter nodemailer-Transport gegen einen stummen SMTP-Server → Abbruch durch `greetingTimeout`
 * - TLS-Regeln aus #15 (`smtpTransportOptions`) bleiben erhalten
 */
import { createServer, type Server, type Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { useTestDatabase } from '../helpers/db';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { getDb, schema } from '$lib/server/core/database/client';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { syncModules } from '$lib/server/core/modules/service';
import { setSettings } from '$lib/server/core/settings/service';
import {
	sendMail,
	setMailTransportForTests,
	setSmtpTimeoutsForTests,
	SMTP_TIMEOUTS
} from '$lib/server/core/mail';
import type { RequestContext } from '$lib/sdk/types';

let close: () => Promise<void>;
let admin: RequestContext;

const msg = { to: 'a@example.test', subject: 'Test', text: 'Hallo', layout: false as const };

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = (await contextForUser(u!.id))!.ctx;
	await setSettings(admin, {
		'core.smtp.host': 'smtp.example.test',
		'core.smtp.port': 2525,
		'core.smtp.from': 'noreply@example.test'
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	setMailTransportForTests(undefined);
	setSmtpTimeoutsForTests({});
});

afterAll(async () => {
	await close();
});

describe('Transport-Cache', () => {
	it('erzeugt den gepoolten Transport einmal und baut ihn nach Einstellungsänderung neu', async () => {
		const sent: unknown[] = [];
		const closed: number[] = [];
		let n = 0;
		const spy = vi.spyOn(nodemailer, 'createTransport').mockImplementation(() => {
			const id = ++n;
			return {
				sendMail: async (m: unknown) => void sent.push(m),
				close: () => void closed.push(id)
			} as unknown as ReturnType<typeof nodemailer.createTransport>;
		});
		await sendMail(msg);
		await sendMail(msg);
		await sendMail(msg);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(sent).toHaveLength(3);
		const options = spy.mock.calls[0]![0] as unknown as Record<string, unknown>;
		expect(options).toMatchObject({
			host: 'smtp.example.test',
			port: 2525,
			pool: true,
			connectionTimeout: SMTP_TIMEOUTS.connectionTimeout,
			greetingTimeout: SMTP_TIMEOUTS.greetingTimeout,
			socketTimeout: SMTP_TIMEOUTS.socketTimeout
		});
		// Ohne Anmeldung: STARTTLS optional (#15 bleibt)
		expect(options.requireTLS).toBe(false);

		await setSettings(admin, { 'core.smtp.from': 'kasse@example.test' });
		await sendMail(msg);
		// Nur der Absender hat sich geändert: Verbindungsdaten gleich, aber Cache verworfen → neuer Pool, alter geschlossen
		expect(spy).toHaveBeenCalledTimes(2);
		expect(closed).toEqual([1]);
		expect((sent.at(-1) as { from: string }).from).toBe('kasse@example.test');
	});

	it('Verbindungsfehler verwerfen den Pool, abgelehnte Empfänger nicht', async () => {
		let n = 0;
		const errorsByCall: (Error & { code?: string })[] = [
			Object.assign(new Error('Empfänger abgelehnt'), { code: 'EENVELOPE' }),
			Object.assign(new Error('Verbindung weg'), { code: 'ECONNECTION' })
		];
		const spy = vi.spyOn(nodemailer, 'createTransport').mockImplementation(() => {
			n++;
			return {
				sendMail: async () => {
					const e = errorsByCall.shift();
					if (e) throw e;
				},
				close: () => undefined
			} as unknown as ReturnType<typeof nodemailer.createTransport>;
		});
		await setSettings(admin, { 'core.smtp.from': 'noreply@example.test' });
		await expect(sendMail(msg)).rejects.toThrow('Empfänger abgelehnt');
		await expect(sendMail(msg)).rejects.toThrow('Verbindung weg');
		await sendMail(msg);
		expect(spy).toHaveBeenCalledTimes(2);
		expect(n).toBe(2);
	});
});

describe('Zeitgrenzen', () => {
	it('hängender Transport → 503 nach der Obergrenze', async () => {
		setSmtpTimeoutsForTests({ sendTimeout: 150 });
		setMailTransportForTests({ sendMail: () => new Promise(() => undefined) });
		const started = Date.now();
		await expect(sendMail(msg)).rejects.toMatchObject({ code: 'unavailable' });
		expect(Date.now() - started).toBeLessThan(2000);
	});

	it('Obergrenze im Standard ≤ 30 s, Einzel-Timeouts gesetzt', () => {
		expect(SMTP_TIMEOUTS.sendTimeout).toBeLessThanOrEqual(30_000);
		expect(SMTP_TIMEOUTS.connectionTimeout).toBeLessThanOrEqual(SMTP_TIMEOUTS.sendTimeout);
		expect(SMTP_TIMEOUTS.greetingTimeout).toBeLessThanOrEqual(SMTP_TIMEOUTS.sendTimeout);
	});

	it('echter Transport gegen stummen SMTP-Server bricht per greetingTimeout ab', async () => {
		const sockets: Socket[] = [];
		const server: Server = createServer((s) => void sockets.push(s)); // nimmt an, grüßt nie
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		const port = (server.address() as { port: number }).port;
		try {
			await setSettings(admin, { 'core.smtp.host': '127.0.0.1', 'core.smtp.port': port });
			setSmtpTimeoutsForTests({ greetingTimeout: 200, sendTimeout: 5000 });
			const started = Date.now();
			await expect(sendMail(msg)).rejects.toBeTruthy();
			expect(Date.now() - started).toBeLessThan(4000);
			expect(sockets.length).toBeGreaterThan(0);
		} finally {
			for (const s of sockets) s.destroy();
			await new Promise<void>((r) => server.close(() => r()));
		}
	});
});
