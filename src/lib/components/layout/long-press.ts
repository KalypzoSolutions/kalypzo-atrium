// Svelte-Action „lange drücken“ für Listenzeilen (Auswahlmodus auf Touch-Geräten).
// Nach dem Auslösen wird der folgende Klick verschluckt, damit die Zeile nicht zusätzlich
// ihr Aktionsblatt öffnet. Bewegt sich der Finger (Scrollen), wird abgebrochen.
// Das Kontextmenü des Browsers (Long-Press auf iOS/Android) wird unterdrückt.

export interface LongPressOptions {
	onlongpress: () => void;
	/** Haltedauer in ms (Standard 500) */
	delay?: number;
	/** Bewegung in px, ab der abgebrochen wird (Standard 10) */
	tolerance?: number;
	/** ausgeschaltet: verhält sich wie ein normales Element */
	disabled?: boolean;
}

export function longpress(node: HTMLElement, initial: LongPressOptions) {
	let opts = initial;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let startX = 0;
	let startY = 0;
	let fired = false;

	const cancel = () => {
		clearTimeout(timer);
		timer = undefined;
	};

	function down(e: PointerEvent) {
		if (opts.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
		fired = false;
		startX = e.clientX;
		startY = e.clientY;
		cancel();
		timer = setTimeout(() => {
			timer = undefined;
			fired = true;
			navigator.vibrate?.(10);
			opts.onlongpress();
		}, opts.delay ?? 500);
	}

	function move(e: PointerEvent) {
		if (!timer) return;
		const tol = opts.tolerance ?? 10;
		if (Math.abs(e.clientX - startX) > tol || Math.abs(e.clientY - startY) > tol) cancel();
	}

	function click(e: MouseEvent) {
		if (!fired) return;
		fired = false;
		e.preventDefault();
		e.stopImmediatePropagation();
	}

	function contextmenu(e: Event) {
		if (!opts.disabled) e.preventDefault();
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', cancel);
	node.addEventListener('pointercancel', cancel);
	node.addEventListener('pointerleave', cancel);
	// capture: vor dem onclick der Zeile
	node.addEventListener('click', click, true);
	node.addEventListener('contextmenu', contextmenu);

	return {
		update(next: LongPressOptions) {
			opts = next;
		},
		destroy() {
			cancel();
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', cancel);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('pointerleave', cancel);
			node.removeEventListener('click', click, true);
			node.removeEventListener('contextmenu', contextmenu);
		}
	};
}
