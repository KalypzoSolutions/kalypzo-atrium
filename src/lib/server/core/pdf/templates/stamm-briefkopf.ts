import { createStammTemplate } from '../parts/stamm';

export default createStammTemplate({
	id: 'stamm-briefkopf',
	label: 'Stamm-Briefkopf (ohne Adressfeld)',
	description:
		'Briefkopf mit Lilie, Vereinsname, Wappen und Fußzeile auf jeder Seite; ohne Adressfeld und Falzmarken.',
	source: 'templates/stamm-briefkopf.ts',
	withAddress: false
});
