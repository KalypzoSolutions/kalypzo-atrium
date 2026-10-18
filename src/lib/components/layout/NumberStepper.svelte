<script lang="ts">
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import { cn } from '$lib/utils';

	let {
		value = $bindable(0),
		min = 0,
		max = Number.MAX_SAFE_INTEGER,
		step = 1,
		label,
		unit,
		id,
		disabled = false,
		invalid = false,
		onchange,
		class: className
	}: {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		/** Zugaengliche Bezeichnung (aria-label) */
		label: string;
		/** Einheit als Suffix, z. B. „Nächte“ */
		unit?: string;
		id?: string;
		disabled?: boolean;
		invalid?: boolean;
		onchange?: (value: number) => void;
		class?: string;
	} = $props();

	let editing = $state(false);
	let text = $state('');

	$effect(() => {
		const v = value;
		if (!editing) text = String(v);
	});

	const clamp = (n: number) => Math.min(Math.max(n, min), max);

	function set(next: number) {
		const v = clamp(next);
		editing = false;
		text = String(v);
		if (v !== value) {
			value = v;
			onchange?.(v);
		}
	}

	function current(): number {
		if (editing && text !== '') {
			const n = parseInt(text, 10);
			if (!Number.isNaN(n)) return n;
		}
		return value;
	}

	function commit() {
		const n = text === '' ? min : parseInt(text, 10);
		set(Number.isNaN(n) ? min : n);
	}

	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		const cleaned = e.currentTarget.value.replace(/\D/g, '');
		editing = true;
		text = cleaned;
		e.currentTarget.value = cleaned;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			commit();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			set(current() + step);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			set(current() - step);
		}
	}

	const btn =
		'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 inline-flex size-8 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-40';
</script>

<div
	data-slot="number-stepper"
	class={cn(
		'border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 inline-flex h-8 w-fit items-center rounded-lg border bg-transparent transition-colors focus-within:ring-3',
		invalid && 'border-destructive ring-destructive/20 ring-3',
		disabled && 'pointer-events-none cursor-not-allowed opacity-50',
		className
	)}
>
	<button
		type="button"
		data-slot="number-stepper-button"
		class={btn}
		aria-label="{label} verringern"
		disabled={disabled || value <= min}
		onclick={() => set(value - step)}
	>
		<Minus class="size-4" />
	</button>
	<input
		{id}
		type="text"
		inputmode="numeric"
		autocomplete="off"
		aria-label={label}
		aria-invalid={invalid || undefined}
		{disabled}
		value={text}
		{oninput}
		{onkeydown}
		onfocus={(e) => e.currentTarget.select()}
		onblur={commit}
		class="w-12 min-w-0 bg-transparent py-1 text-center text-base tabular-nums outline-none md:text-sm"
	/>
	{#if unit}
		<span class="text-muted-foreground -ml-1 pr-1.5 text-sm" aria-hidden="true">{unit}</span>
	{/if}
	<button
		type="button"
		data-slot="number-stepper-button"
		class={btn}
		aria-label="{label} erhöhen"
		disabled={disabled || value >= max}
		onclick={() => set(value + step)}
	>
		<Plus class="size-4" />
	</button>
</div>
