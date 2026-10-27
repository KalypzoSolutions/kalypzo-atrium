import { describe, expect, it } from 'vitest';
import {
	articleTotals,
	cartLines,
	cartSummary,
	clampCart,
	emptyCart,
	freeFromAvailability,
	maxArticleQuantity,
	maxTentCount,
	nextWeekend,
	parseCart,
	partsText,
	problemsByArticle,
	setArticleQuantity,
	setTentCount,
	type Cart
} from '$lib/modules/material/pages/borrow/cart';

const bahn = { id: 'bahn', name: 'Kohtenbahn', unitLabel: 'Stück', kind: 'unit' as const };
const kreuz = { id: 'kreuz', name: 'Kohtenkreuz', unitLabel: 'Stück', kind: 'unit' as const };
const tasse = { id: 'tasse', name: 'Tasse', unitLabel: 'Stück', kind: 'bulk' as const };

const kohte = {
	id: 'kohte',
	name: 'Kohte',
	free: 2,
	parts: [
		{ articleId: 'bahn', articleName: 'Kohtenbahn', quantity: 4 },
		{ articleId: 'kreuz', articleName: 'Kohtenkreuz', quantity: 1 }
	]
};
const jurte = {
	id: 'jurte',
	name: 'Jurte',
	free: 1,
	parts: [{ articleId: 'bahn', articleName: 'Kohtenbahn', quantity: 8 }]
};

describe('Merkliste', () => {
	it('Artikel hinzufügen, ändern, mit 0 entfernen', () => {
		let c = setArticleQuantity(emptyCart(), tasse, 10);
		c = setArticleQuantity(c, bahn, 2);
		expect(c.articles.map((a) => [a.articleId, a.quantity])).toEqual([
			['tasse', 10],
			['bahn', 2]
		]);
		c = setArticleQuantity(c, tasse, 12);
		expect(c.articles[0]!.quantity).toBe(12);
		c = setArticleQuantity(c, tasse, 0);
		expect(c.articles.map((a) => a.articleId)).toEqual(['bahn']);
	});

	it('ungültige Mengen werden geklemmt (NaN, negativ, Kommazahl)', () => {
		expect(setArticleQuantity(emptyCart(), tasse, Number.NaN).articles).toEqual([]);
		expect(setArticleQuantity(emptyCart(), tasse, -3).articles).toEqual([]);
		expect(setArticleQuantity(emptyCart(), tasse, 2.9).articles[0]!.quantity).toBe(2);
	});

	it('Zelt → Teile als Artikel-Zeilen, gleiche Artikel zusammengezählt', () => {
		let c = setTentCount(emptyCart(), kohte, 2);
		c = setTentCount(c, jurte, 1);
		c = setArticleQuantity(c, bahn, 3);
		c = setArticleQuantity(c, tasse, 20);
		// Bahnen: 2 × 4 (Kohten) + 8 (Jurte) + 3 (direkt) = 19; Kreuze: 2 × 1
		expect(Object.fromEntries(articleTotals(c))).toEqual({ bahn: 19, kreuz: 2, tasse: 20 });
		expect(cartLines(c)).toEqual([
			{ kind: 'article', articleId: 'bahn', quantity: 19 },
			{ kind: 'article', articleId: 'kreuz', quantity: 2 },
			{ kind: 'article', articleId: 'tasse', quantity: 20 }
		]);
		expect(cartSummary(c)).toEqual({ positions: 4, items: 41 });
		expect(partsText(c.tents[0]!.parts)).toBe('4 × Kohtenbahn, 1 × Kohtenkreuz');
	});

	it('Stepper-Grenzen: Artikel abzüglich Zelte, Zelte abzüglich übriger Merkliste', () => {
		let c = setTentCount(emptyCart(), kohte, 1);
		expect(maxArticleQuantity(c, 'bahn', 10)).toBe(6);
		expect(maxArticleQuantity(c, 'bahn', 3)).toBe(0);
		c = setArticleQuantity(c, bahn, 3);
		const free = new Map([
			['bahn', 10],
			['kreuz', 5]
		]);
		// Kohte: (10 − 3 direkt) / 4 = 1 (eigene Kohte zählt nicht gegen sich selbst)
		expect(maxTentCount(c, kohte, free)).toBe(1);
		// Jurte: (10 − 4 Kohte − 3 direkt) / 8 = 0
		expect(maxTentCount(c, jurte, free)).toBe(0);
		// Ohne Angaben gilt die freie Zahl des Zelttyps
		expect(maxTentCount(emptyCart(), kohte, new Map())).toBe(2);
	});

	it('Begrenzen: erst Zelte, dann Artikel mit dem Rest; unbekannte bleiben', () => {
		let c: Cart = setTentCount(emptyCart(), kohte, 2);
		c = setArticleQuantity(c, bahn, 5);
		c = setArticleQuantity(c, tasse, 50);
		const out = clampCart(
			c,
			new Map([
				['bahn', 6],
				['kreuz', 9]
			])
		);
		// 6 Bahnen → 1 Kohte (4), Rest 2 direkt; Tassen unbekannt → 50
		expect(out.tents.map((t) => t.count)).toEqual([1]);
		expect(out.articles.map((a) => [a.articleId, a.quantity])).toEqual([
			['bahn', 2],
			['tasse', 50]
		]);
		expect(clampCart(c, new Map([['bahn', 0]]))).toEqual({
			tents: [],
			articles: [c.articles[1]!]
		});
	});

	it('Verfügbarkeit je Zeile auf Artikel abbilden', () => {
		const lines = [{ articleId: 'bahn' }, { articleId: 'kreuz' }, { articleId: 'tasse' }];
		const res = [
			{ index: 0, ok: false, available: 6, message: 'Nur 6 frei', notes: [] },
			{ index: 1, ok: true, available: 9, message: null, notes: [] },
			{ index: 2, ok: false, available: null, message: null, notes: [] }
		];
		expect(Object.fromEntries(freeFromAvailability(lines, res))).toEqual({ bahn: 6, kreuz: 9 });
		expect(Object.fromEntries(problemsByArticle(lines, res))).toEqual({
			bahn: { message: 'Nur 6 frei', available: 6 },
			tasse: { message: 'Im Zeitraum nicht frei', available: null }
		});
	});

	it('Gespeicherte Merkliste robust lesen', () => {
		const good = setTentCount(setArticleQuantity(emptyCart(), kreuz, 2), kohte, 1);
		expect(parseCart(JSON.parse(JSON.stringify(good)))).toEqual(good);
		expect(parseCart(null)).toEqual(emptyCart());
		expect(
			parseCart({
				articles: [
					{ articleId: 'a', name: 'A', quantity: 0 },
					{ articleId: 'b', name: 'B', quantity: 2, kind: 'x' },
					{ articleId: 'b', name: 'B', quantity: 3 }
				],
				tents: [{ templateId: 't', name: 'T', count: 1, parts: [] }]
			})
		).toEqual({
			articles: [{ articleId: 'b', name: 'B', unitLabel: 'Stück', kind: 'unit', quantity: 2 }],
			tents: []
		});
	});
});

describe('Kommendes Wochenende', () => {
	it.each([
		['2026-10-26', '2026-10-31'], // Montag
		['2026-10-30', '2026-10-31'], // Freitag
		['2026-10-31', '2026-10-31'], // Samstag → dieses
		['2026-11-01', '2026-11-07'] // Sonntag → nächstes
	])('%s → Samstag %s', (today, sat) => {
		const w = nextWeekend(today);
		expect(w.from).toBe(sat);
		expect(new Date(`${w.to}T12:00:00Z`).getUTCDay()).toBe(0);
	});
});
