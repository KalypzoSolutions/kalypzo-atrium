<script lang="ts">
	// Rahmen für `ListRow`s: Karte mit Trennlinien; optional Abschnittstitel darüber.
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let {
		heading,
		label,
		children,
		class: className
	}: {
		/** sichtbare Überschrift (klein, Großbuchstaben) */
		heading?: string;
		/** zugänglicher Name der Liste, wenn keine Überschrift */
		label?: string;
		children: Snippet;
		class?: string;
	} = $props();
</script>

<section class="flex flex-col gap-1.5" aria-label={heading ? undefined : label}>
	{#if heading}
		<h3 class="px-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
			{heading}
		</h3>
	{/if}
	<div
		data-slot="touch-list"
		class={cn('overflow-hidden rounded-xl border bg-card text-card-foreground', className)}
	>
		{@render children()}
	</div>
</section>
