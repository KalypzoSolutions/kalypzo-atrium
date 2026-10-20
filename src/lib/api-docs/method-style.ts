import type { ApiMethod } from './types';

/** Badge-Farben je HTTP-Methode (Seite und Detailansicht gemeinsam, hell/dunkel) */
export const METHOD_BADGE_CLASS: Record<ApiMethod, string> = {
	GET: 'border border-sky-600/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
	POST: 'border border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
	PUT: 'border border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
	PATCH: 'border border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
	DELETE: 'border border-destructive/30 bg-destructive/10 text-destructive dark:bg-destructive/20'
};
