// Zurück-Geste für Blätter (`BottomSheet`): Jedes offene Blatt legt per Shallow Routing einen
// Verlaufseintrag an (`page.state.sheet` = Ebene). „Zurück“ (Android-Taste, Wischgeste, Browser)
// schließt dann nur das oberste Blatt statt die Seite zu verlassen. Wird das Blatt in der
// Oberfläche geschlossen, nimmt `history.back()` den Eintrag wieder weg.
//
// Wer danach navigiert oder die URL ersetzt (`goto`, `replaceState`), wartet vorher auf
// `sheetsSettled()` – sonst würde das ausstehende `history.back()` die neue URL zurückdrehen.

let pending: Promise<void> | null = null;

/** Verlaufseintrag eines geschlossenen Blatts entfernen (einmal je Blatt) */
export function popSheetEntry(): void {
	if (typeof window === 'undefined') return;
	const wait = new Promise<void>((resolve) => {
		const done = () => {
			window.removeEventListener('popstate', done);
			clearTimeout(timer);
			// SvelteKit aktualisiert `page.state` im selben Ereignis – einen Takt später ist alles fertig
			setTimeout(resolve, 0);
		};
		// Sicherheitsnetz, falls der Browser kein popstate liefert
		const timer = setTimeout(done, 400);
		window.addEventListener('popstate', done);
	});
	const before = pending ?? Promise.resolve();
	pending = before.then(() => wait);
	const mine = pending;
	void mine.then(() => {
		if (pending === mine) pending = null;
	});
	history.back();
}

/** Wartet, bis alle gerade geschlossenen Blätter ihren Verlaufseintrag entfernt haben */
export function sheetsSettled(): Promise<void> {
	return pending ?? Promise.resolve();
}
