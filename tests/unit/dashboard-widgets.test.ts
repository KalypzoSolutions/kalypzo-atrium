import { describe, expect, it } from 'vitest';
import {
	applyDashboardLayout,
	selectDashboardWidgets,
	toDashboardLayout
} from '../../src/lib/sdk/client/dashboard-widgets';
import type { DashboardWidget } from '../../src/lib/sdk/types/module-ui';

const comp = async () => ({ default: (() => {}) as never });
const w = (id: string, extra: Partial<DashboardWidget> = {}): DashboardWidget => ({
	id,
	title: id,
	component: comp,
	...extra
});

const byModule = {
	core: [w('stats', { order: 90, anyPermission: ['core.users.view', 'core.api.view'] })],
	events: [w('upcoming', { order: 10, permission: 'events.event.view' })],
	treasury: [
		w('tasks', { order: 20, permission: 'treasury.cash.view' }),
		w('mine', { order: 15, permission: 'treasury.own.view' })
	],
	files: [w('recent', { order: 50, defaultHidden: true })]
};

describe('selectDashboardWidgets', () => {
	it('nur aktive Module, core immer, Rechte und anyPermission', () => {
		const sel = selectDashboardWidgets(
			byModule,
			['events', 'treasury'],
			['events.event.view', 'treasury.own.view', 'core.api.view']
		);
		expect(sel.map((x) => x.key)).toEqual(['events:upcoming', 'treasury:mine', 'core:stats']);
	});

	it('ohne passendes anyPermission-Recht entfällt die Kachel', () => {
		const sel = selectDashboardWidgets(byModule, [], ['core.audit.view']);
		expect(sel).toEqual([]);
	});

	it('gleiche order: nach Modul-ID, dann Kachel-ID', () => {
		const sel = selectDashboardWidgets({ b: [w('y'), w('x')], a: [w('z')] }, ['a', 'b'], []);
		expect(sel.map((x) => x.key)).toEqual(['a:z', 'b:x', 'b:y']);
	});
});

describe('applyDashboardLayout', () => {
	const all = selectDashboardWidgets(
		byModule,
		['events', 'treasury', 'files'],
		['events.event.view', 'treasury.own.view', 'treasury.cash.view', 'core.users.view']
	);

	it('ohne Einstellung: Standard-Reihenfolge, defaultHidden aus', () => {
		const r = applyDashboardLayout(all, null);
		expect(r.all.map((x) => x.key)).toEqual([
			'events:upcoming',
			'treasury:mine',
			'treasury:tasks',
			'files:recent',
			'core:stats'
		]);
		expect(r.visible.map((x) => x.key)).not.toContain('files:recent');
		expect(r.hidden.has('files:recent')).toBe(true);
	});

	it('gespeicherte Reihenfolge zuerst, neue dahinter, unbekannte entfallen', () => {
		const r = applyDashboardLayout(all, {
			order: ['core:stats', 'weg:alt', 'treasury:tasks', 'core:stats'],
			hidden: ['treasury:tasks', 'weg:alt']
		});
		expect(r.all.map((x) => x.key)).toEqual([
			'core:stats',
			'treasury:tasks',
			'events:upcoming',
			'treasury:mine',
			'files:recent'
		]);
		expect(r.visible.map((x) => x.key)).toEqual(['core:stats', 'events:upcoming', 'treasury:mine']);
	});

	it('neue Spitzenkacheln (order < 5) landen vor der gespeicherten Reihenfolge', () => {
		const withTop = selectDashboardWidgets(
			{ ...byModule, core: [...byModule.core, w('todos', { order: 1 }), w('week', { order: 2 })] },
			['events', 'treasury', 'files'],
			['events.event.view', 'treasury.own.view', 'core.users.view']
		);
		const r = applyDashboardLayout(withTop, {
			order: ['treasury:mine', 'events:upcoming', 'core:stats'],
			hidden: []
		});
		expect(r.all.map((x) => x.key)).toEqual([
			'core:todos',
			'core:week',
			'treasury:mine',
			'events:upcoming',
			'core:stats',
			'files:recent'
		]);
		// einmal gespeichert, gilt wieder die gespeicherte Reihenfolge
		const again = applyDashboardLayout(withTop, {
			order: ['treasury:mine', 'core:todos', 'core:week'],
			hidden: []
		});
		expect(again.all.slice(0, 3).map((x) => x.key)).toEqual([
			'treasury:mine',
			'core:todos',
			'core:week'
		]);
	});

	it('eingeschaltete defaultHidden-Kachel bleibt sichtbar', () => {
		const r = applyDashboardLayout(all, { order: ['files:recent'], hidden: [] });
		expect(r.visible.map((x) => x.key)).toContain('files:recent');
	});

	it('toDashboardLayout speichert Reihenfolge und ausgeblendete Schlüssel', () => {
		const r = applyDashboardLayout(all, null);
		expect(toDashboardLayout(r.all, r.hidden)).toEqual({
			order: r.all.map((x) => x.key),
			hidden: ['files:recent']
		});
	});
});
