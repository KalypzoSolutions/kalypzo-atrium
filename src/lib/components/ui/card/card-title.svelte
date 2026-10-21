<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	/**
	 * Kartentitel als echte Überschrift (#71, WCAG 1.3.1): Standard `h2`, Unterkarten/Karten in Dialogen `level={3}`,
	 * alleinstehende Karten öffentlicher Seiten (Login, Passwort) `level={1}`. Größe kommt aus der Karte, nicht aus der Ebene.
	 */
	let {
		ref = $bindable(null),
		class: className,
		level = 2,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLHeadingElement>> & {
		level?: 1 | 2 | 3 | 4 | 5 | 6;
	} = $props();
</script>

<svelte:element
	this={`h${level}`}
	bind:this={ref}
	data-slot="card-title"
	class={cn('text-base leading-snug font-semibold group-data-[size=sm]/card:text-sm', className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
