/** Vertrag des Fixture-Moduls „Pinnwand“ für abhängige Module (nur Typen) */
export interface BoardService {
	/** Anzahl der Einträge (ohne Rechteprüfung) */
	countNotes(): Promise<number>;
}
