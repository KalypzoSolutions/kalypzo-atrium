import { templates } from 'virtual:atrium-core/pdf-templates';
import { registerTemplate } from './templates';

let loaded = false;

/** Registriert alle Vorlagen aus `templates/*.ts` (je `export default` ein PdfTemplate); idempotent. */
export function loadTemplates(): void {
	if (loaded) return;
	for (const template of templates) {
		if (template) registerTemplate(template);
	}
	loaded = true;
}
