<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Label } from '$lib/components/ui/label';

	let {
		label,
		id,
		error,
		hint,
		children
	}: {
		label: string;
		id: string;
		error?: string | null;
		hint?: string;
		children: Snippet;
	} = $props();
</script>

<div class="grid gap-1.5">
	<Label for={id}>{label}</Label>
	{@render children()}
	{#if hint && !error}<p id="{id}-hint" class="text-xs text-muted-foreground">{hint}</p>{/if}
	{#if error}<p id="{id}-error" role="alert" class="text-xs text-destructive">{error}</p>{/if}
</div>
