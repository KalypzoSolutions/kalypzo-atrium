<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	/**
	 * Aktionsleiste (z. B. Bulk-Aktionen nach Auswahl): auf Mobil (< 640 px) am unteren Rand fixiert,
	 * ab `sm` ein normaler Block im Fluss. Erscheint nur, wenn `show` gesetzt ist.
	 * Die Seite braucht dann unten Luft (z. B. `pb-20` am Inhalt), damit nichts verdeckt wird.
	 */
	let {
		show = true,
		label,
		class: className,
		children
	}: {
		show?: boolean;
		/** Zugängliche Bezeichnung der Leiste */
		label: string;
		class?: string;
		children: Snippet;
	} = $props();
</script>

{#if show}
	<div
		role="toolbar"
		aria-label={label}
		class={cn(
			'safe-bottom flex flex-wrap items-center gap-2 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-40 max-sm:border-t max-sm:bg-background/95 max-sm:px-4 max-sm:pt-2 max-sm:shadow-lg max-sm:backdrop-blur max-sm:[&>*]:min-h-9',
			className
		)}
	>
		{@render children()}
	</div>
{/if}
