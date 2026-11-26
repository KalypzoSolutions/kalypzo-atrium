<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from 'bits-ui';
	import type { ComponentProps } from 'svelte';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		inset,
		...restProps
	}: ComponentProps<typeof ContextMenuPrimitive.GroupHeading> & {
		inset?: boolean;
	} = $props();
</script>

<ContextMenuPrimitive.GroupHeading
	bind:ref
	data-slot="context-menu-group-heading"
	data-inset={inset}
	class={cn('text-muted-foreground px-1.5 py-1 text-xs font-medium data-inset:pl-7', className)}
	{...restProps}
/>
