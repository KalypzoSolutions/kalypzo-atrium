<script lang="ts">
	import { t } from '$lib/i18n';
	/**
	 * Verlaufseditor: einfarbig, linear, radial oder Mesh (Farbflecken). Farbpunkte auf der Leiste ziehen
	 * (Tastatur: Pfeile verschieben, Umschalt = 10er-Schritte, Entf entfernt), Klick auf die Leiste fügt einen
	 * Punkt hinzu; Mesh-Flecken werden auf der Vorschau verschoben.
	 */
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import {
		cssBackground,
		RADIAL_POSITIONS,
		SPOTS_MAX,
		STOPS_MAX,
		STOPS_MIN,
		type BackgroundKind,
		type RadialPosition,
		type ThemeBackground
	} from '$lib/appearance';
	import { Button } from '$lib/components/ui/button';
	import { ColorPicker } from '$lib/components/ui/color-picker';
	import { SegmentedSlider } from '$lib/components/ui/segmented-slider';
	import { Slider } from '$lib/components/ui/slider';
	import { cn } from '$lib/utils';
	import { addSpot, addStop, convertBackground, moveStop, removeStop } from './gradient';

	let {
		value = $bindable(),
		onchange,
		label,
		presets,
		class: className
	}: {
		value: ThemeBackground;
		onchange?: (value: ThemeBackground) => void;
		/** Barrierefreier Name (z. B. „Hintergrund hell“) */
		label: string;
		/** Farbvorschläge im Farbwähler */
		presets?: string[];
		class?: string;
	} = $props();

	const KINDS: { value: BackgroundKind; label: string }[] = [
		{ value: 'solid', label: t('ui.gradient.kind.solid') },
		{ value: 'linear', label: t('ui.gradient.kind.linear') },
		{ value: 'radial', label: t('ui.gradient.kind.radial') },
		{ value: 'mesh', label: t('ui.gradient.kind.mesh') }
	];
	const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
	const POSITION_LABELS: Record<RadialPosition, string> = {
		'top-left': t('ui.gradient.positions.topLeft'),
		top: t('ui.gradient.positions.top'),
		'top-right': t('ui.gradient.positions.topRight'),
		left: t('ui.gradient.positions.left'),
		center: t('ui.gradient.positions.center'),
		right: t('ui.gradient.positions.right'),
		'bottom-left': t('ui.gradient.positions.bottomLeft'),
		bottom: t('ui.gradient.positions.bottom'),
		'bottom-right': t('ui.gradient.positions.bottomRight')
	};

	let selected = $state(0);
	let barEl: HTMLElement | null = $state(null);
	let stageEl: HTMLElement | null = $state(null);
	let dragging = $state(false);

	function set(next: ThemeBackground) {
		value = next;
		onchange?.(next);
	}

	const stops = $derived(value.kind === 'linear' || value.kind === 'radial' ? value.stops : []);
	const spots = $derived(value.kind === 'mesh' ? value.spots : []);
	const count = $derived(value.kind === 'mesh' ? spots.length : stops.length);
	const current = $derived(Math.min(selected, Math.max(0, count - 1)));
	const barBackground = $derived(
		`linear-gradient(90deg, ${[...stops]
			.sort((a, b) => a.pos - b.pos)
			.map((s) => `${s.color} ${s.pos}%`)
			.join(', ')})`
	);

	function setStops(next: typeof stops) {
		if (value.kind === 'linear' || value.kind === 'radial') set({ ...value, stops: next });
	}
	function setSpots(next: typeof spots) {
		if (value.kind === 'mesh') set({ ...value, spots: next });
	}

	function changeKind(kind: BackgroundKind) {
		selected = 0;
		set(convertBackground(value, kind));
	}

	function posFrom(e: PointerEvent, el: HTMLElement | null): { x: number; y: number } {
		const r = el?.getBoundingClientRect();
		if (!r || !r.width || !r.height) return { x: 0, y: 0 };
		return {
			x: ((e.clientX - r.left) / r.width) * 100,
			y: ((e.clientY - r.top) / r.height) * 100
		};
	}

	function onBarClick(e: MouseEvent) {
		if (dragging || !barEl || e.target !== barEl) return;
		const r = barEl.getBoundingClientRect();
		const res = addStop(stops, ((e.clientX - r.left) / r.width) * 100);
		if (res.index < 0) return;
		setStops(res.stops);
		selected = res.index;
	}

	function startDrag(e: PointerEvent, index: number, area: 'bar' | 'stage') {
		e.preventDefault();
		e.stopPropagation();
		selected = index;
		const target = e.currentTarget as HTMLElement;
		target.setPointerCapture(e.pointerId);
		target.focus();
		dragging = true;
		const move = (ev: PointerEvent) => {
			if (area === 'bar') {
				setStops(moveStop(stops, index, posFrom(ev, barEl).x));
			} else {
				const p = posFrom(ev, stageEl);
				const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, n)));
				setSpots(spots.map((s, i) => (i === index ? { ...s, x: clamp(p.x), y: clamp(p.y) } : s)));
			}
		};
		const up = () => {
			target.removeEventListener('pointermove', move);
			target.removeEventListener('pointerup', up);
			target.removeEventListener('pointercancel', up);
			// Klick nach dem Ziehen nicht als „Punkt hinzufügen“ werten
			setTimeout(() => (dragging = false), 0);
		};
		target.addEventListener('pointermove', move);
		target.addEventListener('pointerup', up);
		target.addEventListener('pointercancel', up);
	}

	function stopKey(e: KeyboardEvent, index: number) {
		const step = e.shiftKey ? 10 : 1;
		const s = stops[index];
		if (!s) return;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
			setStops(moveStop(stops, index, s.pos - step));
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
			setStops(moveStop(stops, index, s.pos + step));
		} else if (e.key === 'Home') {
			setStops(moveStop(stops, index, 0));
		} else if (e.key === 'End') {
			setStops(moveStop(stops, index, 100));
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && stops.length > STOPS_MIN) {
			setStops(removeStop(stops, index));
			selected = Math.max(0, index - 1);
		} else return;
		e.preventDefault();
	}

	function spotKey(e: KeyboardEvent, index: number) {
		const step = e.shiftKey ? 10 : 2;
		const s = spots[index];
		if (!s) return;
		const clamp = (n: number) => Math.min(100, Math.max(0, n));
		let next = s;
		if (e.key === 'ArrowLeft') next = { ...s, x: clamp(s.x - step) };
		else if (e.key === 'ArrowRight') next = { ...s, x: clamp(s.x + step) };
		else if (e.key === 'ArrowUp') next = { ...s, y: clamp(s.y - step) };
		else if (e.key === 'ArrowDown') next = { ...s, y: clamp(s.y + step) };
		else if ((e.key === 'Delete' || e.key === 'Backspace') && spots.length > 1) {
			setSpots(spots.filter((_, i) => i !== index));
			selected = Math.max(0, index - 1);
			e.preventDefault();
			return;
		} else return;
		e.preventDefault();
		setSpots(spots.map((x, i) => (i === index ? next : x)));
	}
</script>

<div class={cn('grid gap-4', className)} role="group" aria-label={label}>
	<SegmentedSlider
		value={value.kind}
		options={KINDS}
		label={t('ui.gradient.kindLabel')}
		onchange={changeKind}
	/>

	<!-- Vorschau; bei Farbflecken mit verschiebbaren Punkten -->
	<div
		bind:this={stageEl}
		class="relative h-36 overflow-hidden rounded-lg border sm:h-44"
		style:background-image={cssBackground(value)}
	>
		{#if value.kind === 'mesh'}
			{#each spots as s, i (i)}
				<button
					type="button"
					class={cn(
						'absolute size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-white shadow-md ring-1 ring-black/20 focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing',
						i === current && 'ring-2 ring-foreground'
					)}
					style:left="{s.x}%"
					style:top="{s.y}%"
					style:background-color={s.color}
					aria-label={t('ui.gradient.moveSpot', {
						n: i + 1,
						x: Math.round(s.x),
						y: Math.round(s.y)
					})}
					aria-pressed={i === current}
					onpointerdown={(e) => startDrag(e, i, 'stage')}
					onkeydown={(e) => spotKey(e, i)}
					onclick={() => (selected = i)}
				></button>
			{/each}
		{/if}
	</div>

	{#if value.kind === 'solid'}
		{@const bg = value}
		<div class="grid gap-1.5">
			<span class="text-sm font-medium">{t('ui.gradient.color')}</span>
			<ColorPicker
				label={t('ui.gradient.backgroundColor')}
				value={bg.color}
				{presets}
				onchange={(c) => c && set({ ...bg, color: c })}
			/>
		</div>
	{:else if value.kind === 'linear' || value.kind === 'radial'}
		<div class="grid gap-2">
			<div class="flex items-center justify-between gap-2">
				<span class="text-sm font-medium" id="gradient-stops-label">{t('ui.gradient.stops')}</span>
				<span class="text-xs text-muted-foreground">
					{t('ui.gradient.stopsHint', { count: stops.length, max: STOPS_MAX })}
				</span>
			</div>
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (Hinzufügen per Knopf unten) -->
			<div
				bind:this={barEl}
				class="relative mx-3 h-7 cursor-copy rounded-md border shadow-inner"
				style:background-image={barBackground}
				onclick={onBarClick}
			>
				{#each stops as s, i (i)}
					<button
						type="button"
						role="slider"
						aria-label={t('ui.gradient.stop', { n: i + 1, color: s.color })}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(s.pos)}
						aria-valuetext="{Math.round(s.pos)} %"
						class={cn(
							'absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-white shadow-md ring-1 ring-black/25 focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing',
							i === current && 'z-10 scale-110 ring-2 ring-foreground'
						)}
						style:left="{s.pos}%"
						style:background-color={s.color}
						onpointerdown={(e) => startDrag(e, i, 'bar')}
						onkeydown={(e) => stopKey(e, i)}
						onclick={(e) => {
							e.stopPropagation();
							selected = i;
						}}
					></button>
				{/each}
			</div>
		</div>

		{@const stop = stops[current]}
		{#if stop}
			<div class="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
				<div class="grid gap-1.5">
					<span class="text-xs font-medium text-muted-foreground"
						>{t('ui.gradient.stopN', { n: current + 1 })}</span
					>
					<ColorPicker
						label={t('ui.gradient.stopColor', { n: current + 1 })}
						value={stop.color}
						{presets}
						onchange={(c) =>
							c && setStops(stops.map((x, i) => (i === current ? { ...x, color: c } : x)))}
					/>
				</div>
				<div class="grid min-w-36 flex-1 gap-1.5">
					<span class="text-xs font-medium text-muted-foreground">
						{t('ui.gradient.position', { pos: Math.round(stop.pos) })}
					</span>
					<Slider
						label={t('ui.gradient.stopPosition', { n: current + 1 })}
						value={stop.pos}
						min={0}
						max={100}
						onchange={(v) => setStops(moveStop(stops, current, v))}
					/>
				</div>
				<div class="flex gap-1">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={stops.length >= STOPS_MAX}
						onclick={() => {
							const res = addStop(stops, Math.min(100, stop.pos + 10));
							if (res.index >= 0) {
								setStops(res.stops);
								selected = res.index;
							}
						}}><Plus /> {t('ui.gradient.addStop')}</Button
					>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={t('ui.gradient.removeStop', { n: current + 1 })}
						disabled={stops.length <= STOPS_MIN}
						onclick={() => {
							setStops(removeStop(stops, current));
							selected = Math.max(0, current - 1);
						}}><Trash2 /></Button
					>
				</div>
			</div>
		{/if}

		{#if value.kind === 'linear'}
			{@const bg = value}
			<div class="grid gap-2">
				<span class="text-sm font-medium">{t('ui.gradient.angle', { a: bg.angle })}</span>
				<div class="flex flex-wrap items-center gap-3">
					<div class="flex flex-wrap gap-1">
						{#each ANGLES as a (a)}
							<Button
								type="button"
								variant={bg.angle === a ? 'default' : 'outline'}
								size="icon-sm"
								aria-label={t('ui.gradient.angle', { a })}
								aria-pressed={bg.angle === a}
								onclick={() => set({ ...bg, angle: a })}
							>
								<ArrowUp style="transform: rotate({a}deg)" />
							</Button>
						{/each}
					</div>
					<Slider
						class="min-w-36 flex-1"
						label={t('ui.gradient.angleLabel')}
						value={bg.angle}
						min={0}
						max={359}
						onchange={(v) => set({ ...bg, angle: v })}
					/>
				</div>
			</div>
		{:else}
			{@const bg = value}
			<fieldset class="grid gap-2">
				<legend class="mb-1 text-sm font-medium">{t('ui.gradient.center')}</legend>
				<div class="grid w-fit grid-cols-3 gap-1">
					{#each RADIAL_POSITIONS as pos (pos)}
						<Button
							type="button"
							variant={bg.at === pos ? 'default' : 'outline'}
							size="icon-sm"
							aria-label={POSITION_LABELS[pos]}
							aria-pressed={bg.at === pos}
							onclick={() => set({ ...bg, at: pos })}
						>
							<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
						</Button>
					{/each}
				</div>
			</fieldset>
		{/if}
	{:else if value.kind === 'mesh'}
		{@const bg = value}
		<div class="flex flex-wrap items-end gap-3">
			<div class="grid gap-1.5">
				<span class="text-sm font-medium">{t('ui.gradient.baseColor')}</span>
				<ColorPicker
					label={t('ui.gradient.baseColor')}
					value={bg.base}
					{presets}
					onchange={(c) => c && set({ ...bg, base: c })}
				/>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={spots.length >= SPOTS_MAX}
				onclick={() => {
					setSpots(addSpot(spots));
					selected = spots.length;
				}}><Plus /> {t('ui.gradient.addSpot')}</Button
			>
			<span class="text-xs text-muted-foreground">
				{t('ui.gradient.spotsHint', { count: spots.length, max: SPOTS_MAX })}
			</span>
		</div>
		{@const spot = spots[current]}
		{#if spot}
			<div class="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
				<div class="grid gap-1.5">
					<span class="text-xs font-medium text-muted-foreground"
						>{t('ui.gradient.spot', { n: current + 1 })}</span
					>
					<ColorPicker
						label={t('ui.gradient.spotColor', { n: current + 1 })}
						value={spot.color}
						{presets}
						onchange={(c) =>
							c && setSpots(spots.map((x, i) => (i === current ? { ...x, color: c } : x)))}
					/>
				</div>
				<div class="grid min-w-36 flex-1 gap-1.5">
					<span class="text-xs font-medium text-muted-foreground"
						>{t('ui.gradient.sizeValue', { size: spot.size })}</span
					>
					<Slider
						label={t('ui.gradient.spotSize', { n: current + 1 })}
						value={spot.size}
						min={10}
						max={100}
						onchange={(v) => setSpots(spots.map((x, i) => (i === current ? { ...x, size: v } : x)))}
					/>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={t('ui.gradient.removeSpot', { n: current + 1 })}
					disabled={spots.length <= 1}
					onclick={() => {
						setSpots(spots.filter((_, i) => i !== current));
						selected = Math.max(0, current - 1);
					}}><Trash2 /></Button
				>
			</div>
		{/if}
	{/if}
</div>
