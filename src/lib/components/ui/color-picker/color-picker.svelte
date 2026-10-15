<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { cn } from '$lib/utils.js';
	import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from './color.js';

	const SV_GRADIENT =
		'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)';
	const HUE_GRADIENT = 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)';
	const DEFAULT_PRESETS = [
		'#2f855a',
		'#276749',
		'#68d391',
		'#2b6cb0',
		'#3182ce',
		'#63b3ed',
		'#c53030',
		'#e53e3e',
		'#dd6b20',
		'#ecc94b',
		'#805ad5',
		'#718096'
	];

	let {
		value = $bindable(null),
		onchange,
		label,
		presets = DEFAULT_PRESETS,
		id,
		disabled = false,
		invalid = false,
		allowClear = false,
		class: className
	}: {
		value: string | null;
		onchange?: (value: string | null) => void;
		label: string;
		presets?: string[];
		id?: string;
		disabled?: boolean;
		invalid?: boolean;
		allowClear?: boolean;
		class?: string;
	} = $props();

	let open = $state(false);
	let hsv = $state<Hsv>({ h: 150, s: 0.6, v: 0.6 });
	let hexText = $state('');
	let hexError = $state<string | null>(null);
	let areaEl: HTMLElement | null = $state(null);
	let hueEl: HTMLElement | null = $state(null);

	const current = $derived(value ? normalizeHex(value) : null);
	const hueColor = $derived(hsvToHex({ h: hsv.h, s: 1, v: 1 }));
	const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

	function commit(next: string | null) {
		value = next;
		onchange?.(next);
	}
	function applyHsv(next: Hsv) {
		hsv = next;
		const hex = hsvToHex(next);
		hexText = hex;
		hexError = null;
		if (hex !== current) commit(hex);
	}
	function applyHex(hex: string) {
		const parsed = hexToHsv(hex);
		if (!parsed) return;
		// Farbton bei Grau/Schwarz beibehalten, damit der Regler nicht springt
		hsv = { h: parsed.s === 0 ? hsv.h : parsed.h, s: parsed.s, v: parsed.v };
		hexText = hex;
		hexError = null;
		if (hex !== current) commit(hex);
	}

	$effect(() => {
		if (open) {
			const c = current;
			const parsed = c ? hexToHsv(c) : null;
			if (parsed) hsv = parsed;
			hexText = c ?? '';
			hexError = null;
		}
	});

	function onHexInput() {
		const t = hexText.trim();
		if (t === '') {
			hexError = null;
			return;
		}
		const n = normalizeHex(t.startsWith('#') ? t : `#${t}`);
		if (n) applyHex(n);
		else hexError = 'Ungültiger Hex-Code, z. B. #2f855a oder #3a7';
	}

	// --- Flaeche (Saettigung / Helligkeit) ---
	function pointToSv(e: PointerEvent) {
		if (!areaEl) return;
		const rect = areaEl.getBoundingClientRect();
		applyHsv({
			h: hsv.h,
			s: clamp01((e.clientX - rect.left) / rect.width),
			v: 1 - clamp01((e.clientY - rect.top) / rect.height)
		});
	}
	function onAreaDown(e: PointerEvent) {
		if (disabled) return;
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		el.focus();
		pointToSv(e);
	}
	function onAreaMove(e: PointerEvent) {
		if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) pointToSv(e);
	}
	function onAreaKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 0.1 : 0.01;
		let { s, v } = hsv;
		if (e.key === 'ArrowRight') s += step;
		else if (e.key === 'ArrowLeft') s -= step;
		else if (e.key === 'ArrowUp') v += step;
		else if (e.key === 'ArrowDown') v -= step;
		else return;
		e.preventDefault();
		applyHsv({ h: hsv.h, s: clamp01(s), v: clamp01(v) });
	}

	// --- Farbton ---
	function pointToHue(e: PointerEvent) {
		if (!hueEl) return;
		const rect = hueEl.getBoundingClientRect();
		applyHsv({ ...hsv, h: clamp01((e.clientX - rect.left) / rect.width) * 360 });
	}
	function onHueDown(e: PointerEvent) {
		if (disabled) return;
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		el.focus();
		pointToHue(e);
	}
	function onHueMove(e: PointerEvent) {
		if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) pointToHue(e);
	}
	function onHueKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 10 : 1;
		let h = hsv.h;
		if (e.key === 'ArrowRight' || e.key === 'ArrowUp') h += step;
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') h -= step;
		else if (e.key === 'Home') h = 0;
		else if (e.key === 'End') h = 360;
		else return;
		e.preventDefault();
		applyHsv({ ...hsv, h: Math.min(360, Math.max(0, h)) });
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		{id}
		{disabled}
		aria-label={label}
		aria-invalid={invalid ? 'true' : undefined}
		data-slot="color-picker"
		class={cn(
			'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 flex h-8 w-fit min-w-32 items-center gap-2 rounded-lg border bg-transparent px-2 text-sm transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
			invalid && 'border-destructive ring-destructive/20 dark:ring-destructive/40 ring-3',
			className
		)}
	>
		<span
			class="border-border size-4 shrink-0 rounded-sm border"
			style:background-color={current ?? undefined}
			style:background-image={current
				? undefined
				: 'repeating-linear-gradient(45deg, transparent 0 3px, var(--border) 3px 4px)'}
			aria-hidden="true"
		></span>
		{#if current}
			<span class="font-mono text-xs">{current}</span>
		{:else}
			<span class="text-muted-foreground text-xs">Keine Farbe</span>
		{/if}
	</Popover.Trigger>
	<Popover.Content class="w-64 space-y-3 p-3">
		<div
			bind:this={areaEl}
			role="slider"
			tabindex="0"
			aria-label={`${label}: Sättigung und Helligkeit`}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(hsv.s * 100)}
			aria-valuetext={`Sättigung ${Math.round(hsv.s * 100)} %, Helligkeit ${Math.round(hsv.v * 100)} %`}
			class="focus-visible:ring-ring/50 relative h-36 w-full cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-3"
			style:background-color={hueColor}
			style:background-image={SV_GRADIENT}
			onpointerdown={onAreaDown}
			onpointermove={onAreaMove}
			onkeydown={onAreaKey}
		>
			<span
				class="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
				style:left={`${hsv.s * 100}%`}
				style:top={`${(1 - hsv.v) * 100}%`}
				style:background-color={hsvToHex(hsv)}
			></span>
		</div>

		<div
			bind:this={hueEl}
			role="slider"
			tabindex="0"
			aria-label={`${label}: Farbton`}
			aria-valuemin={0}
			aria-valuemax={360}
			aria-valuenow={Math.round(hsv.h)}
			class="focus-visible:ring-ring/50 relative h-3 w-full cursor-pointer touch-none rounded-full outline-none focus-visible:ring-3"
			style:background-image={HUE_GRADIENT}
			onpointerdown={onHueDown}
			onpointermove={onHueMove}
			onkeydown={onHueKey}
		>
			<span
				class="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
				style:left={`${(hsv.h / 360) * 100}%`}
				style:background-color={hueColor}
			></span>
		</div>

		<div class="space-y-1">
			<div class="flex items-center gap-2">
				<span
					class="border-border size-8 shrink-0 rounded-md border"
					style:background-color={hsvToHex(hsv)}
					aria-hidden="true"
				></span>
				<input
					type="text"
					aria-label={`${label}: Hex-Code`}
					aria-invalid={hexError ? 'true' : undefined}
					autocomplete="off"
					spellcheck="false"
					maxlength="7"
					placeholder="#rrggbb"
					bind:value={hexText}
					oninput={onHexInput}
					class={cn(
						'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 font-mono text-sm outline-none focus-visible:ring-3',
						hexError && 'border-destructive'
					)}
				/>
			</div>
			{#if hexError}
				<p class="text-destructive text-xs" role="alert">{hexError}</p>
			{/if}
		</div>

		{#if presets.length}
			<div class="flex flex-wrap gap-1.5" role="group" aria-label="Vorgabefarben">
				{#each presets as p (p)}
					{@const n = normalizeHex(p)}
					{#if n}
						<button
							type="button"
							aria-label={`Farbe ${n}`}
							aria-pressed={n === current}
							class={cn(
								'border-border focus-visible:ring-ring/50 size-6 rounded-md border outline-none focus-visible:ring-3',
								n === current && 'ring-foreground ring-2 ring-offset-1'
							)}
							style:background-color={n}
							onclick={() => applyHex(n)}
						></button>
					{/if}
				{/each}
			</div>
		{/if}

		{#if allowClear}
			<button
				type="button"
				disabled={current === null}
				class="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline disabled:no-underline disabled:opacity-50"
				onclick={() => {
					hexText = '';
					hexError = null;
					commit(null);
				}}
			>
				Farbe entfernen
			</button>
		{/if}
	</Popover.Content>
</Popover.Root>
