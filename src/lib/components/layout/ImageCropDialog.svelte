<script lang="ts">
	import ZoomIn from '@lucide/svelte/icons/zoom-in';
	import ZoomOut from '@lucide/svelte/icons/zoom-out';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { ColorPicker } from '$lib/components/ui/color-picker';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Slider } from '$lib/components/ui/slider';
	import { BUSY_LOAD, BUSY_SAVE } from './busy';
	import {
		DEFAULT_CROP_BACKGROUND,
		TRANSPARENT_CROP_BACKGROUND,
		cropFill,
		MAX_CROP_ZOOM,
		croppedFileName,
		displaySize,
		frameFor,
		minZoom,
		outputFor,
		panBy,
		placement,
		zoomAround,
		type CropState,
		type Point,
		type Size
	} from './image-crop';

	/**
	 * Bild zuschneiden: Ausschnitt per Ziehen (Maus/Finger), Zoom per Regler, Mausrad, zwei Finger oder Tastatur.
	 * Herauszoomen über das Bild hinaus ist möglich; Ränder und transparente Flächen bekommen die Hintergrundfarbe.
	 * Erzeugt im Browser ein neues Bild (WebP, sonst JPEG) und gibt es über `onconfirm` zurück.
	 */
	let {
		open = $bindable(false),
		file,
		aspect = 1,
		shape = 'rect',
		maxEdge = 1600,
		title = 'Bild zuschneiden',
		background = DEFAULT_CROP_BACKGROUND,
		onconfirm,
		oncancel
	}: {
		open?: boolean;
		file: File | null;
		/** Seitenverhältnis Breite / Höhe des Ergebnisses */
		aspect?: number;
		/** `circle` zeigt eine runde Maske (Profilbild); das Ergebnis bleibt rechteckig */
		shape?: 'rect' | 'circle';
		/** Lange Kante des Ergebnisses in Pixeln */
		maxEdge?: number;
		title?: string;
		/** Startwert für Ränder und transparente Flächen: Farbe oder `'transparent'` (im Dialog änderbar) */
		background?: string | null;
		onconfirm: (file: File) => void;
		oncancel?: () => void;
	} = $props();

	const frame = $derived(frameFor(shape === 'circle' ? 1 : aspect));
	const ratio = $derived(frame.width / frame.height);

	let imgEl = $state<HTMLImageElement | null>(null);
	let src = $state<string | null>(null);
	let natural = $state<Size>({ width: 0, height: 0 });
	let loadError = $state('');
	let busy = $state(false);
	let crop = $state<CropState>({ zoom: 1, offset: { x: 0, y: 0 } });
	let bg = $state<string | null>(DEFAULT_CROP_BACKGROUND);
	let transparent = $state(false);
	/** Geschlossen über „Übernehmen“ (sonst gilt Schließen als Abbrechen) */
	let confirmed = false;

	/** Breite des Rahmens in CSS-Pixeln (Umrechnung Zeiger ↔ Rahmeneinheiten) */
	let frameEl = $state<HTMLDivElement | null>(null);
	let stageEl = $state<HTMLDivElement | null>(null);
	let frameWidth = $state(0);

	const ready = $derived(natural.width > 0 && !loadError);
	const shown = $derived(displaySize(natural, frame, crop.zoom));
	const minZ = $derived(ready ? minZoom(natural, frame) : 1);
	const startsTransparent = $derived(background === TRANSPARENT_CROP_BACKGROUND);
	const startColor = $derived(
		background && !startsTransparent ? background : DEFAULT_CROP_BACKGROUND
	);
	/** `null` = Ränder bleiben durchsichtig */
	const fill = $derived(cropFill(transparent, bg));
	/** Schachbrett als Vorschau für „durchsichtig“ (feste Grautöne wie die übrige Bildbühne) */
	const CHECKERBOARD =
		'background-color: #ffffff; background-image: conic-gradient(#d4d4d4 25%, transparent 0 50%, #d4d4d4 0 75%, transparent 0); background-size: 16px 16px;';
	const frameBackground = $derived(
		!ready ? '' : fill ? `background-color: ${fill};` : CHECKERBOARD
	);
	const bgPresets = $derived(
		[...new Set(['#ffffff', '#000000', startColor.toLowerCase()])].filter(Boolean)
	);

	// Objekt-URL je Datei, solange der Dialog offen ist
	$effect(() => {
		if (!open || !file) return;
		const url = URL.createObjectURL(file);
		src = url;
		natural = { width: 0, height: 0 };
		loadError = '';
		crop = { zoom: 1, offset: { x: 0, y: 0 } };
		bg = startColor;
		transparent = startsTransparent;
		confirmed = false;
		return () => {
			URL.revokeObjectURL(url);
			src = null;
		};
	});

	function onload() {
		if (!imgEl) return;
		natural = { width: imgEl.naturalWidth, height: imgEl.naturalHeight };
		if (!natural.width || !natural.height) loadError = 'Bild konnte nicht gelesen werden.';
	}

	function onerror() {
		loadError = 'Bild konnte nicht gelesen werden.';
	}

	function setZoom(z: number, point: Point = { x: 0, y: 0 }) {
		crop = zoomAround(crop, z, point, natural, frame);
	}

	function reset() {
		crop = { zoom: 1, offset: { x: 0, y: 0 } };
	}

	/** Zeigerposition relativ zur Rahmenmitte in Rahmeneinheiten */
	function framePoint(clientX: number, clientY: number): Point {
		if (!frameEl || !frameWidth) return { x: 0, y: 0 };
		const r = frameEl.getBoundingClientRect();
		return {
			x: (clientX - (r.left + r.width / 2)) / frameWidth,
			y: (clientY - (r.top + r.height / 2)) / frameWidth
		};
	}

	// --- Ziehen und zwei Finger
	const pointers = new Map<number, { x: number; y: number }>();
	let pinch: { dist: number; zoom: number } | null = null;

	function distance(): number {
		const [a, b] = [...pointers.values()];
		return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
	}

	function midpoint(): { x: number; y: number } {
		const ps = [...pointers.values()];
		return {
			x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
			y: ps.reduce((s, p) => s + p.y, 0) / ps.length
		};
	}

	function onpointerdown(e: PointerEvent) {
		if (!ready || (e.pointerType === 'mouse' && e.button !== 0)) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		pinch = pointers.size === 2 ? { dist: distance(), zoom: crop.zoom } : null;
	}

	function onpointermove(e: PointerEvent) {
		const prev = pointers.get(e.pointerId);
		if (!prev || !frameWidth) return;
		const before = midpoint();
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		const after = midpoint();
		crop = panBy(
			crop,
			{ x: (after.x - before.x) / frameWidth, y: (after.y - before.y) / frameWidth },
			natural,
			frame
		);
		if (pinch && pointers.size === 2 && pinch.dist > 0) {
			setZoom(pinch.zoom * (distance() / pinch.dist), framePoint(after.x, after.y));
		}
	}

	function onpointerup(e: PointerEvent) {
		pointers.delete(e.pointerId);
		pinch = pointers.size === 2 ? { dist: distance(), zoom: crop.zoom } : null;
	}

	// Mausrad: nicht-passiv, damit der Dialog nicht scrollt
	$effect(() => {
		const el = stageEl;
		if (!el) return;
		const wheel = (e: WheelEvent) => {
			if (!ready) return;
			e.preventDefault();
			setZoom(crop.zoom * Math.exp(-e.deltaY * 0.0015), framePoint(e.clientX, e.clientY));
		};
		el.addEventListener('wheel', wheel, { passive: false });
		return () => el.removeEventListener('wheel', wheel);
	});

	function onkeydown(e: KeyboardEvent) {
		if (!ready) return;
		const step = e.shiftKey ? 0.1 : 0.02;
		const moves: Record<string, Point> = {
			ArrowLeft: { x: step, y: 0 },
			ArrowRight: { x: -step, y: 0 },
			ArrowUp: { x: 0, y: step },
			ArrowDown: { x: 0, y: -step }
		};
		const move = moves[e.key];
		if (move) {
			crop = panBy(crop, move, natural, frame);
		} else if (e.key === '+' || e.key === '=') {
			setZoom(crop.zoom * 1.1);
		} else if (e.key === '-') {
			setZoom(crop.zoom / 1.1);
		} else if (e.key === '0') {
			reset();
		} else {
			return;
		}
		e.preventDefault();
	}

	// --- Ergebnis erzeugen
	function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
		return new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
	}

	async function confirm() {
		if (!imgEl || !ready || !file) return;
		busy = true;
		try {
			const size = outputFor(crop, natural, frame, maxEdge);
			const rect = placement(crop, natural, frame, size);
			const canvas = document.createElement('canvas');
			canvas.width = size.width;
			canvas.height = size.height;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Canvas nicht verfügbar');
			ctx.imageSmoothingQuality = 'high';
			// Erst die Hintergrundfarbe (Ränder beim Herauszoomen, transparente Flächen), dann das Bild
			if (fill) {
				ctx.fillStyle = fill;
				ctx.fillRect(0, 0, size.width, size.height);
			}
			ctx.drawImage(imgEl, rect.dx, rect.dy, rect.dw, rect.dh);
			let blob = await toBlob(canvas, 'image/webp');
			// Browser ohne WebP-Encoder (Safari): mit Farbe JPEG, transparent PNG (behält den Alphakanal)
			if (!blob || blob.type !== 'image/webp') {
				blob = await toBlob(canvas, fill ? 'image/jpeg' : 'image/png');
			}
			if (!blob) throw new Error('Bild konnte nicht erzeugt werden');
			const out = new File([blob], croppedFileName(file.name, blob.type), { type: blob.type });
			confirmed = true;
			open = false;
			onconfirm(out);
		} catch {
			loadError = 'Der Ausschnitt konnte nicht erzeugt werden.';
		} finally {
			busy = false;
		}
	}

	// Schließen ohne „Übernehmen“ (Abbrechen, Escape, Klick daneben) = abbrechen
	function onOpenChange(next: boolean) {
		if (!next && !confirmed) oncancel?.();
	}

	function cancel() {
		open = false;
		onOpenChange(false);
	}

	const zoomPercent = $derived(Math.round(crop.zoom * 100));
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>
				Ziehe das Bild, um den Ausschnitt zu wählen, und zoome mit dem Regler – auch über das Bild
				hinaus.
			</Dialog.Description>
		</Dialog.Header>

		{#if loadError}
			<Alert variant="destructive"
				><AlertDescription role="alert">{loadError}</AlertDescription></Alert
			>
		{/if}

		<!-- Bühne: Umgebung abgedunkelt, Rahmen = späteres Ergebnis. role="application": eigene Tastatur-/Zeigerbedienung -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={stageEl}
			class="relative mx-auto w-full shrink-0 touch-none rounded-md select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {ready
				? 'cursor-grab active:cursor-grabbing'
				: ''}"
			style="aspect-ratio: {ratio}; max-width: max(12rem, calc((100dvh - 21rem) * {ratio}));"
			role="application"
			tabindex="0"
			aria-label="Bildausschnitt. Mit den Pfeiltasten verschieben, mit Plus und Minus zoomen, 0 setzt zurück."
			{onpointerdown}
			{onpointermove}
			{onpointerup}
			onpointercancel={onpointerup}
			{onkeydown}
		>
			<!-- Beschnitt innen: außen ohne overflow, damit die Höhe aus dem Seitenverhältnis im Dialog-Raster erhalten bleibt -->
			<div class="absolute inset-0 overflow-hidden rounded-md bg-muted">
				<div
					bind:this={frameEl}
					bind:clientWidth={frameWidth}
					class="absolute inset-[8%]"
					class:rounded-full={shape === 'circle'}
					style={frameBackground}
				>
					{#if src}
						<img
							bind:this={imgEl}
							{src}
							alt=""
							draggable="false"
							{onload}
							{onerror}
							class="pointer-events-none absolute top-1/2 left-1/2 h-auto max-w-none"
							class:invisible={!ready}
							style="width: {shown.width * 100}%; transform: translate(-50%, -50%) translate({crop
								.offset.x * frameWidth}px, {crop.offset.y * frameWidth}px);"
						/>
					{/if}
					<!-- Maske außerhalb des Rahmens + Rahmenlinie (feste Farben, Bildbühne wie im Bildbetrachter) -->
					<div
						class="pointer-events-none absolute inset-0"
						class:rounded-full={shape === 'circle'}
						style="box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.55); outline: 2px solid rgb(255 255 255 / 0.9);"
					></div>
				</div>
				{#if !ready && !loadError}
					<p class="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
						{BUSY_LOAD}
					</p>
				{/if}
			</div>
		</div>

		<div class="flex items-center gap-2">
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label="Verkleinern"
				disabled={!ready || crop.zoom <= minZ + 0.001}
				onclick={() => setZoom(crop.zoom / 1.2)}
			>
				<ZoomOut />
			</Button>
			<Slider
				value={crop.zoom}
				min={minZ}
				max={MAX_CROP_ZOOM}
				step={0.01}
				label="Zoom"
				disabled={!ready}
				onchange={(z) => setZoom(z)}
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label="Vergrößern"
				disabled={!ready || crop.zoom >= MAX_CROP_ZOOM}
				onclick={() => setZoom(crop.zoom * 1.2)}
			>
				<ZoomIn />
			</Button>
			<span class="w-12 text-right text-xs text-muted-foreground tabular-nums">{zoomPercent} %</span
			>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label="Ausschnitt zurücksetzen"
				disabled={!ready}
				onclick={reset}
			>
				<RotateCcw />
			</Button>
		</div>

		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<label for="crop-background" class="text-sm font-medium">Hintergrund</label>
			<ColorPicker
				id="crop-background"
				label="Hintergrundfarbe"
				bind:value={bg}
				presets={bgPresets}
				disabled={!ready || transparent}
			/>
			<label class="flex items-center gap-2 text-sm">
				<Checkbox bind:checked={transparent} disabled={!ready} />
				Transparent
			</label>
			<span class="w-full text-xs text-muted-foreground">
				für Ränder beim Herauszoomen und durchsichtige Bilder
			</span>
		</div>

		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={cancel}>Abbrechen</Button>
			<Button type="button" disabled={!ready || busy} onclick={confirm}>
				{busy ? BUSY_SAVE : 'Übernehmen'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
