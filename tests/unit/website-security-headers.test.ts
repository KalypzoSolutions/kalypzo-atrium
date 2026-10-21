import { describe, expect, it } from 'vitest';
import { FALLBACK_CSP, withSecurityHeaders } from '../../website/src/lib/server/security-headers';
import websiteConfig from '../../website/svelte.config.js';

// #67 (01b-13): Stammeswebsite liefert CSP, X-Frame-Options, Referrer-Policy (und HSTS über HTTPS).
describe('Stammeswebsite: Sicherheits-Header', () => {
	it('ergänzt die Header, ohne eine vorhandene CSP (kit.csp) zu überschreiben', () => {
		const page = new Response('<html></html>', {
			headers: {
				'content-type': 'text/html',
				'content-security-policy': "script-src 'self' 'nonce-x'"
			}
		});
		const res = withSecurityHeaders(page, { https: true });
		expect(res.headers.get('content-security-policy')).toBe("script-src 'self' 'nonce-x'");
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('strict-transport-security')).toMatch(/max-age=31536000/);
	});

	it('Antworten ohne CSP bekommen eine Minimal-CSP mit frame-ancestors none; kein HSTS über HTTP', () => {
		const res = withSecurityHeaders(new Response('x'), { https: false });
		expect(res.headers.get('content-security-policy')).toBe(FALLBACK_CSP);
		expect(FALLBACK_CSP).toContain("frame-ancestors 'none'");
		expect(res.headers.get('strict-transport-security')).toBeNull();
	});

	it('unveränderliche Header → Kopie mit Headern', async () => {
		const original = Response.redirect('https://example.org/', 302);
		const res = withSecurityHeaders(original, { https: true });
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.status).toBe(302);
	});

	it('kit.csp: mode auto, frame-ancestors none, keine fremden Skripte', () => {
		const csp = (
			websiteConfig as { kit: { csp: { mode: string; directives: Record<string, string[]> } } }
		).kit.csp;
		expect(csp.mode).toBe('auto');
		expect(csp.directives['frame-ancestors']).toEqual(['none']);
		expect(csp.directives['script-src']).toEqual(['self']);
		expect(csp.directives['object-src']).toEqual(['none']);
	});
});
