<script lang="ts" generics="T extends string">
	/**
	 * Regler mit festen Stufen (z. B. Aus · E-Mail · Beides · Push): Spur mit gleitendem Knopf, Tastatur
	 * über Pfeiltasten (bits-ui RadioGroup), gesperrte Stufen bleiben sichtbar, sind aber nicht wählbar.
	 */
	import { RadioGroup } from 'bits-ui';
	import { cn } from '$lib/utils.js';
	import type { SegmentedOption } from './types';

	let {
		value = $bindable(),
		options,
		label,
		disabled = false,
		onchange,
		class: className
	}: {
		value: T;
		options: SegmentedOption<T>[];
		/** Barrierefreier Name der Gruppe */
		label: string;
		disabled?: boolean;
		onchange?: (value: T) => void;
		class?: string;
	} = $props();

	const index = $derived(
		Math.max(
			0,
			options.findIndex((o) => o.value === value)
		)
	);
</script>

<RadioGroup.Root
	{value}
	onValueChange={(v) => {
		if (v === value) return;
		value = v as T;
		onchange?.(v as T);
	}}
	orientation="horizontal"
	{disabled}
	aria-label={label}
	data-slot="segmented-slider"
	class={cn(
		'bg-muted relative inline-grid h-9 w-full max-w-sm items-stretch rounded-full p-0.5 select-none',
		disabled && 'opacity-60',
		className
	)}
	style="grid-template-columns: repeat({options.length}, minmax(0, 1fr));"
>
	<span
		aria-hidden="true"
		class="bg-background ring-border/60 pointer-events-none absolute inset-y-0.5 left-0.5 rounded-full shadow-sm ring-1 transition-transform duration-200 motion-reduce:transition-none"
		style="width: calc((100% - 4px) / {options.length}); transform: translateX({index * 100}%);"
	></span>
	{#each options as option (option.value)}
		<RadioGroup.Item
			value={option.value}
			disabled={option.disabled}
			title={option.hint}
			class="text-muted-foreground data-[state=checked]:text-foreground focus-visible:ring-ring relative z-10 flex min-w-0 items-center justify-center rounded-full px-1 text-xs font-medium outline-none focus-visible:ring-2 data-disabled:cursor-not-allowed data-disabled:opacity-40 sm:text-sm [@media(pointer:coarse)]:min-h-9"
		>
			<span class="truncate">{option.label}</span>
		</RadioGroup.Item>
	{/each}
</RadioGroup.Root>
