/**
 * Stammeswebsite: Bot-Falle (`website/src/lib/server/bot-trap.ts`) – 24 h, Verdrängung der ältesten,
 * gute Crawler ausgenommen, keine Klartext-IP im Log.
 */
import { describe, expect, it } from 'vitest';
import {
	BOT_TRAP_TTL_MS,
	createBotTrap,
	isGoodCrawler
} from '../../website/src/lib/server/bot-trap';

function setup(max = 10_000) {
	let now = 1_000_000;
	const logs: string[] = [];
	const trap = createBotTrap({ max, now: () => now, log: (m) => logs.push(m) });
	return { trap, logs, advance: (ms: number) => (now += ms) };
}

describe('Bot-Falle', () => {
	it('fängt eine IP für 24 Stunden', () => {
		const { trap, advance } = setup();
		expect(trap.isTrapped('203.0.113.7')).toBe(false);
		expect(trap.trap('203.0.113.7', 'curl/8.0')).toBe(true);
		expect(trap.isTrapped('203.0.113.7')).toBe(true);
		expect(trap.isTrapped('203.0.113.8')).toBe(false);
		advance(BOT_TRAP_TTL_MS - 1);
		expect(trap.isTrapped('203.0.113.7')).toBe(true);
		advance(1);
		expect(trap.isTrapped('203.0.113.7')).toBe(false);
		expect(trap.size()).toBe(0);
	});

	it('erneutes Fangen verlängert die Frist', () => {
		const { trap, advance } = setup();
		trap.trap('198.51.100.1');
		advance(BOT_TRAP_TTL_MS - 10);
		trap.trap('198.51.100.1');
		advance(100);
		expect(trap.isTrapped('198.51.100.1')).toBe(true);
	});

	it('verdrängt bei vollem Speicher die ältesten Einträge', () => {
		const { trap, advance } = setup(3);
		for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
			trap.trap(ip);
			advance(1);
		}
		// 10.0.0.1 neu gefangen → rückt ans Ende, ältester ist jetzt 10.0.0.2
		trap.trap('10.0.0.1');
		trap.trap('10.0.0.4');
		expect(trap.size()).toBe(3);
		expect(trap.isTrapped('10.0.0.2')).toBe(false);
		expect(trap.isTrapped('10.0.0.1')).toBe(true);
		expect(trap.isTrapped('10.0.0.3')).toBe(true);
		expect(trap.isTrapped('10.0.0.4')).toBe(true);
	});

	it('nimmt bekannte Suchmaschinen aus', () => {
		const { trap } = setup();
		const agents = [
			'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
			'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
			'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
			'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1)',
			'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'
		];
		for (const ua of agents) {
			expect(isGoodCrawler(ua)).toBe(true);
			expect(trap.trap('192.0.2.50', ua)).toBe(false);
		}
		expect(trap.isTrapped('192.0.2.50')).toBe(false);
		expect(isGoodCrawler('python-requests/2.31')).toBe(false);
		expect(isGoodCrawler(null)).toBe(false);
	});

	it('fängt nie ohne verwertbare IP (sonst träfe es alle)', () => {
		const { trap } = setup();
		expect(trap.trap('unbekannt')).toBe(false);
		expect(trap.trap('')).toBe(false);
		expect(trap.trap(null)).toBe(false);
		expect(trap.isTrapped('unbekannt')).toBe(false);
		expect(trap.size()).toBe(0);
	});

	it('protokolliert ohne Klartext-IP (gekürzter Hash)', () => {
		const { trap, logs } = setup();
		trap.trap('2001:db8::1234', 'evil-bot');
		expect(logs).toHaveLength(1);
		expect(logs[0]).not.toContain('2001:db8');
		expect(logs[0]).toMatch(/\[bot-trap\] Besucher [0-9a-f]{12} gefangen/);
	});
});
