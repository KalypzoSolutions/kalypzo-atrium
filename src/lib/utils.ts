import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Typo-Skala aus `app.css` (`text-title`, `text-section`, `text-caption`) als Schriftgröße bekannt machen –
 * sonst hielte tailwind-merge sie für Textfarben und würfe sie neben `text-muted-foreground` weg.
 */
const twMerge = extendTailwindMerge({
	extend: { classGroups: { 'font-size': [{ text: ['title', 'section', 'caption'] }] } }
});

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
// biome-ignore lint/suspicious/noExplicitAny: shadcn-Hilfstyp, beliebige Props
export type WithoutChildrenOrChild<T> = T extends { children?: any; child?: any }
	? Omit<T, 'children' | 'child'>
	: T;
// biome-ignore lint/suspicious/noExplicitAny: shadcn-Hilfstyp, beliebige Props
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
// biome-ignore lint/suspicious/noExplicitAny: shadcn-Hilfstyp, beliebige Props
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
