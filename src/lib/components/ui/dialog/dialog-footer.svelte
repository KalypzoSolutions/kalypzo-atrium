<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		showCloseButton = false,
		sticky = true,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		showCloseButton?: boolean;
		/** Fußzeile bleibt beim Scrollen unten im Dialog sichtbar (Standard; mobil wichtig für lange Formulare) */
		sticky?: boolean;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="dialog-footer"
	class={cn(
		'bg-muted/50 -mx-4 -mb-4 rounded-b-xl border-t p-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
		// deckender Grund (gleiche Optik wie bg-muted/50 auf dem Dialog), damit scrollender Inhalt nicht durchscheint
		sticky && 'sticky bottom-0 z-10 bg-[color-mix(in_oklab,var(--muted)_50%,var(--popover))]',
		className
	)}
	{...restProps}
>
	{@render children?.()}
	{#if showCloseButton}
		<DialogPrimitive.Close>
			{#snippet child({ props })}
				<Button variant="outline" {...props}>Schließen</Button>
			{/snippet}
		</DialogPrimitive.Close>
	{/if}
</div>
