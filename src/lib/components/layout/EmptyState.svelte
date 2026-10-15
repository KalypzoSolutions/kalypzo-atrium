<script lang="ts">
	import type { Snippet } from 'svelte';
	import Inbox from '@lucide/svelte/icons/inbox';

	let {
		title,
		description,
		children
	}: { title: string; description?: string; children?: Snippet } = $props();
</script>

<div
	class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center"
>
	<Inbox class="size-8 text-muted-foreground" aria-hidden="true" />
	<p class="font-medium">{title}</p>
	{#if description}<p class="max-w-md text-sm text-muted-foreground">{description}</p>{/if}
	{#if children}<div class="mt-2">{@render children()}</div>{/if}
</div>
