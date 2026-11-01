import { createLetterTemplate } from '../parts/letter';

export default createLetterTemplate({
	id: 'briefkopf-quer',
	label: 'pdf.templates.briefkopfQuer.label',
	description: 'pdf.templates.briefkopfQuer.description',
	source: 'templates/briefkopf-quer.ts',
	withAddress: false,
	orientation: 'landscape'
});
