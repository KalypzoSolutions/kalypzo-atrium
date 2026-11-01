import { createLetterTemplate } from '../parts/letter';

export default createLetterTemplate({
	id: 'briefkopf',
	label: 'pdf.templates.briefkopf.label',
	description: 'pdf.templates.briefkopf.description',
	source: 'templates/briefkopf.ts',
	withAddress: false
});
