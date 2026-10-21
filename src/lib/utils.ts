import { clsx, type ClassValue } from 'clsx';
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildrenOrChild<T> = T extends { children?: any; child?: any }
	? Omit<T, 'children' | 'child'>
	: T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
