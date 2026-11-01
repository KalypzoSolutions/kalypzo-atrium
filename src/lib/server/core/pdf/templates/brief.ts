import { createLetterTemplate } from '../parts/letter';

export default createLetterTemplate({
	id: 'brief',
	label: 'pdf.templates.brief.label',
	description: 'pdf.templates.brief.description',
	source: 'templates/brief.ts',
	withAddress: true
});
