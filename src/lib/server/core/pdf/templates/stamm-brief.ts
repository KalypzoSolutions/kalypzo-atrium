import { createStammTemplate } from '../parts/stamm';

export default createStammTemplate({
	id: 'stamm-brief',
	label: 'Stamm-Brief (mit Adressfeld)',
	description:
		'Briefkopf mit Falzmarken und Adressfeld (84 × 40 mm, Fensterumschlag) sowie Fußzeile auf jeder Seite.',
	source: 'templates/stamm-brief.ts',
	withAddress: true
});
