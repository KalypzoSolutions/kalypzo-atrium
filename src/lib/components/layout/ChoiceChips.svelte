<script lang="ts" generics="T extends string">
	// Auswahl als große Chips (Filterblatt): eine Gruppe mit Überschrift, Einfachauswahl.
	// Touch-Ziel 40 px; aktive Chips getönt in der Akzentfarbe.
	import { cn } from '$lib/utils.js';

	let {
		legend,
		options,
		value,
		onchange,
		class: className
	}: {
		/** Überschrift der Gruppe, z. B. „Sortieren“ */
		legend: string;
		options: { value: T; label: string }[];
		value: T;
		onchange: (value: T) => void;
		class?: string;
	} = $props();
</script>

<fieldset data-slot="choice-chips" class={cn('flex flex-col gap-2.5 px-5 pt-1.5 pb-3', className)}>
	<legend class="mb-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
		{legend}
	</legend>
	<div class="flex flex-wrap gap-2">
		{#each options as o (o.value)}
			{@const active = o.value === value}
			<button
				type="button"
				class={cn(
					'flex h-10 items-center rounded-full border px-3.5 text-sm font-medium transition-colors',
					active ? 'border-link bg-link/10 font-semibold text-link' : 'bg-background hover:bg-muted'
				)}
				aria-pressed={active}
				onclick={() => onchange(o.value)}
			>
				{o.label}
			</button>
		{/each}
	</div>
</fieldset>
