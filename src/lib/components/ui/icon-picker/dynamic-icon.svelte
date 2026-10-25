<script lang="ts">
	// Icon aus der Icon-Bibliothek per Name (z. B. aus der Datenbank). Bis die Daten geladen sind bzw. bei
	// unbekanntem Namen erscheint `fallback` (oder nichts).
	import type { Snippet } from 'svelte';
	import type { SVGAttributes } from 'svelte/elements';
	import { iconStore } from './icons-state.svelte';

	let {
		name,
		strokeWidth = 2,
		fallback,
		class: className,
		...rest
	}: {
		/** Icon-Name (`tree-pine`); leer = `fallback` */
		name: string | null | undefined;
		strokeWidth?: number;
		fallback?: Snippet;
		class?: string;
	} & Omit<SVGAttributes<SVGSVGElement>, 'class'> = $props();

	$effect(() => {
		if (name) iconStore.ensure();
	});

	const node = $derived(name ? iconStore.set?.get(name) : undefined);
	const labelled = $derived(!!rest['aria-label'] || !!rest['aria-labelledby']);
</script>

{#if node}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="24"
		height="24"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width={strokeWidth}
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden={labelled ? undefined : 'true'}
		role={labelled ? 'img' : undefined}
		class={className}
		{...rest}
	>
		{#each node as [tag, attrs], i (i)}
			<svelte:element this={tag} {...attrs} />
		{/each}
	</svg>
{:else if fallback}
	{@render fallback()}
{/if}
