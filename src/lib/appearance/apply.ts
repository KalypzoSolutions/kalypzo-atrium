/**
 * Theme im Browser anwenden (ohne Neuladen): Variablen und `data-app-theme` am `<html>` setzen bzw. entfernen.
 * Der Server liefert beim ersten Laden dasselbe über `%app.style%` (`applyAppearance`).
 */
import { THEME_VAR_KEYS } from './css';

export function applyThemeVars(vars: Record<string, string> | null, accent?: string): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	for (const key of THEME_VAR_KEYS) root.style.removeProperty(key);
	if (vars) for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
	root.dataset.appTheme = vars ? 'on' : '';
	if (accent) root.style.setProperty('--accent-color', accent);
}
