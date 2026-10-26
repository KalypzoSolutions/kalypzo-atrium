<script lang="ts" module>
	import type { Component } from 'svelte';

	export interface MobileTabItem {
		value: string;
		label: string;
		icon: Component<{ class?: string }>;
		/** Aktionsknopf (z. B. „Neu“) statt Bereich: hervorgehoben, nie „aktiv“ */
		action?: boolean;
	}
</script>

<script lang="ts">
	// Bereichsleiste unten (Handy): 3–5 Einträge, Daumenzone, Safe-Area unten.
	// Die Seite braucht unten Luft (`pb-24`), damit nichts verdeckt wird.
	import { cn } from '$lib/utils.js';

	let {
		items,
		value,
		label,
		onselect,
		class: className
	}: {
		items: MobileTabItem[];
		/** aktiver Bereich */
		value: string;
		/** zugänglicher Name der Navigation */
		label: string;
		onselect: (value: string) => void;
		class?: string;
	} = $props();
</script>

<nav
	aria-label={label}
	data-slot="mobile-tab-bar"
	class={cn(
		'safe-bottom app-glass fixed inset-x-0 bottom-0 z-40 grid gap-1 border-t bg-background/95 px-2 pt-1.5 backdrop-blur',
		className
	)}
	style="grid-template-columns: repeat({items.length}, minmax(0, 1fr));"
>
	{#each items as item (item.value)}
		{@const active = !item.action && item.value === value}
		<button
			type="button"
			class={cn(
				'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium text-muted-foreground transition-colors',
				active && 'bg-muted text-foreground'
			)}
			aria-current={active ? 'page' : undefined}
			onclick={() => onselect(item.value)}
		>
			{#if item.action}
				<span
					class="flex h-6 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground"
					aria-hidden="true"
				>
					<item.icon class="size-4.5" />
				</span>
			{:else}
				<item.icon class="size-5" />
			{/if}
			{item.label}
		</button>
	{/each}
</nav>
