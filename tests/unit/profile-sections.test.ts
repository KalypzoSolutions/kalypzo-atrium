import { describe, expect, it } from 'vitest';
import { selectProfileSections } from '$lib/sdk/client/profile-sections';
import type { ProfileSection } from '$lib/sdk/types/module-ui';

const comp = async () => ({ default: (() => null) as never });
const sec = (id: string, extra: Partial<ProfileSection> = {}): ProfileSection => ({
	id,
	title: id,
	component: comp,
	...extra
});

describe('selectProfileSections', () => {
	const all = {
		members: [
			sec('children', { order: 10, permission: 'members.own.view' }),
			sec('mail', { order: 20 })
		],
		actions: [sec('mine')],
		off: [sec('hidden')]
	};

	it('filtert nach aktiven Modulen und Rechten', () => {
		const r = selectProfileSections(all, ['members', 'actions'], ['members.own.view']);
		expect(r.map((s) => s.key)).toEqual(['members:children', 'members:mail', 'actions:mine']);
		expect(r.every((s) => s.moduleId)).toBe(true);
	});

	it('blendet Abschnitte ohne Recht aus, Abschnitte ohne permission bleiben', () => {
		const r = selectProfileSections(all, ['members', 'actions'], []);
		expect(r.map((s) => s.key)).toEqual(['members:mail', 'actions:mine']);
	});

	it('sortiert nach order (Standard 100), dann Modul-ID und ID', () => {
		const r = selectProfileSections(
			{ b: [sec('z'), sec('a')], a: [sec('x')], c: [sec('first', { order: 1 })] },
			['a', 'b', 'c'],
			[]
		);
		expect(r.map((s) => s.key)).toEqual(['c:first', 'a:x', 'b:a', 'b:z']);
	});

	it('ignoriert Module ohne Abschnitte und unbekannte aktive Module', () => {
		expect(selectProfileSections({ m: undefined }, ['m', 'nope'], [])).toEqual([]);
	});
});
