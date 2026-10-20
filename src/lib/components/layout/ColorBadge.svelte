<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { contrastTextColor } from '$lib/components/ui/color-picker/color';

	/** Badge in frei wählbarer Farbe (`#rrggbb`) mit automatisch lesbarer Textfarbe. */
	let {
		color,
		class: className,
		children
	}: { color?: string | null; class?: string; children: Snippet } = $props();

	const style = $derived(
		color ? `background-color:${color};color:${contrastTextColor(color)};border-color:${color}` : ''
	);
</script>

{#if color}
	<Badge variant="outline" class={className} {style}>{@render children()}</Badge>
{:else}
	<Badge variant="outline" class={className}>{@render children()}</Badge>
{/if}
