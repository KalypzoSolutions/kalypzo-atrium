import { registerTemplate, type PdfTemplate } from './templates';

let loaded = false;

/** Registriert alle Vorlagen aus `templates/*.ts` (je `export default` ein PdfTemplate); idempotent. */
export function loadTemplates(): void {
	if (loaded) return;
	const modules = import.meta.glob<{ default: PdfTemplate }>('./templates/*.ts', { eager: true });
	for (const mod of Object.values(modules)) {
		if (mod.default) registerTemplate(mod.default);
	}
	loaded = true;
}
