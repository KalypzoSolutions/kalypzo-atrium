// Geräteklasse für Seiten mit eigener Handy-/Tablet-Bedienung (z. B. Kasse).
// - phone:   schmaler als 640 px (Tailwind `sm`) – Bereichsleiste unten, Blätter von unten
// - tablet:  640–1366 px mit Touch als Hauptzeiger (iPad hoch/quer) – Liste | Details, Popover
// - desktop: alles andere – unverändert
// Beim Server-Rendering gilt „desktop“; nach dem Hydrieren stimmt der Wert sofort.
import { MediaQuery } from 'svelte/reactivity';

export type DeviceLayout = 'phone' | 'tablet' | 'desktop';

export const PHONE_QUERY = '(max-width: 639.98px)';
export const TABLET_QUERY = '(min-width: 640px) and (max-width: 1366px) and (pointer: coarse)';

const phone = new MediaQuery(PHONE_QUERY, false);
const tablet = new MediaQuery(TABLET_QUERY, false);

/** Aktuelle Geräteklasse (reaktiv in Komponenten und `$derived`) */
export function deviceLayout(): DeviceLayout {
	if (phone.current) return 'phone';
	if (tablet.current) return 'tablet';
	return 'desktop';
}
