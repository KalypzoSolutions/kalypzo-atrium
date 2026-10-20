import { createStammTemplate } from '../parts/stamm';

export default createStammTemplate({
	id: 'stamm-briefkopf-quer',
	label: 'Stamm-Briefkopf quer (ohne Adressfeld)',
	description:
		'A4 quer für breite Tabellen und Listen: Lilie, Vereinsname, Wappen und Fußzeile auf jeder Seite; ohne Adressfeld und Falzmarken.',
	source: 'templates/stamm-briefkopf-quer.ts',
	withAddress: false,
	orientation: 'landscape'
});
