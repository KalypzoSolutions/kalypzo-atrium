/**
 * Einheitliche Seitentitel (#71, WCAG 2.4.2): „Seite – Systemname“. Ohne Systemname nur die Seite,
 * ohne Seite nur der Systemname.
 */
export function documentTitle(page?: string | null, systemName?: string | null): string {
	const p = page?.trim();
	const s = systemName?.trim();
	if (p && s && p !== s) return `${p} – ${s}`;
	return p || s || 'EP Intern';
}

/**
 * Bezeichnung der Modulseite aus der Navigation: der Eintrag mit dem längsten passenden `path`
 * (exakt oder als Präfix mit `/`), sonst `null`.
 */
export function navLabelFor(
	navigation: readonly { label: string; path: string }[],
	pathname: string
): string | null {
	let best: { label: string; path: string } | null = null;
	for (const n of navigation) {
		const p = n.path.replace(/\/+$/, '');
		if (pathname !== p && !pathname.startsWith(p + '/')) continue;
		if (!best || p.length > best.path.length) best = { label: n.label, path: p };
	}
	return best?.label ?? null;
}
