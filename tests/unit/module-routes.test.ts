import { describe, expect, it } from 'vitest';
import { matchModuleRoute } from '../../src/lib/sdk/client/routes';

const keys = ['', 'groups', 'actions/:id', 'actions/:id/edit', 'a/:x/:y'];

describe('matchModuleRoute', () => {
	it('trifft exakte Pfade, auch den leeren', () => {
		expect(matchModuleRoute(keys, '')).toEqual({ key: '', params: {} });
		expect(matchModuleRoute(keys, '/groups/')).toEqual({ key: 'groups', params: {} });
	});
	it('liest :param-Segmente und dekodiert sie', () => {
		expect(matchModuleRoute(keys, 'actions/abc-123')).toEqual({
			key: 'actions/:id',
			params: { id: 'abc-123' }
		});
		expect(matchModuleRoute(keys, 'actions/a%20b/edit')).toEqual({
			key: 'actions/:id/edit',
			params: { id: 'a b' }
		});
		expect(matchModuleRoute(keys, 'a/1/2')?.params).toEqual({ x: '1', y: '2' });
	});
	it('gibt bei unbekannten Pfaden null zurueck', () => {
		expect(matchModuleRoute(keys, 'actions')).toBeNull();
		expect(matchModuleRoute(keys, 'actions/1/2/3')).toBeNull();
		expect(matchModuleRoute(keys, 'nope')).toBeNull();
		expect(matchModuleRoute(keys, 'actions/%E0%A4%A')).toBeNull();
	});
	it('bevorzugt exakte Treffer vor Mustern', () => {
		expect(matchModuleRoute(['actions/:id', 'actions/new'], 'actions/new')).toEqual({
			key: 'actions/new',
			params: {}
		});
	});
});
