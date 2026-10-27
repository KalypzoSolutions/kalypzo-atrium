/**
 * Erkennung von USB-Handscannern („Tastatur-Modus“): Der Scanner tippt den Code sehr schnell und
 * schließt mit Enter ab. `ScanBuffer` sammelt Zeichen, solange die Abstände klein bleiben; eine
 * langsame Taste (Mensch) beginnt von vorn.
 */
export interface ScanBufferOptions {
	/** Mindestlänge eines Codes (Standard 3) */
	minLength?: number;
	/** Größter Abstand zwischen zwei Zeichen in ms (Standard 60) */
	maxGapMs?: number;
}

export class ScanBuffer {
	#chars = '';
	#last = 0;
	readonly #min: number;
	readonly #gap: number;

	constructor(opts: ScanBufferOptions = {}) {
		this.#min = opts.minLength ?? 3;
		this.#gap = opts.maxGapMs ?? 60;
	}

	/** Eine Taste verarbeiten; liefert den Code bei Enter, sonst `null` */
	push(key: string, timeMs: number): string | null {
		if (this.#chars && timeMs - this.#last > this.#gap) this.#chars = '';
		this.#last = timeMs;
		if (key === 'Enter' || key === 'Tab') {
			const code = this.#chars;
			this.#chars = '';
			return code.length >= this.#min ? code : null;
		}
		if (key.length === 1) this.#chars += key;
		return null;
	}

	reset(): void {
		this.#chars = '';
	}
}

function isEditable(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.closest('[data-scan-field]')) return false;
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target.getAttribute('role') === 'combobox'
	);
}

/**
 * Hört global auf USB-Scanner (nicht in Eingabefeldern, außer mit `data-scan-field`).
 * Gibt eine Abmeldefunktion zurück. Nur im Browser aufrufen.
 */
export function listenForScanner(
	onscan: (code: string) => void,
	opts: ScanBufferOptions = {}
): () => void {
	const buffer = new ScanBuffer(opts);
	const handler = (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
		const code = buffer.push(e.key, e.timeStamp || performance.now());
		if (code) {
			e.preventDefault();
			onscan(code);
		}
	};
	window.addEventListener('keydown', handler, true);
	return () => window.removeEventListener('keydown', handler, true);
}
