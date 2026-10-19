<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Copy from '@lucide/svelte/icons/copy';
	import type { ApiCatalogEntry } from '$lib/api-docs/types';
	import { exampleFromSchema } from '$lib/api-docs/example';
	import { Button } from '$lib/components/ui/button';
	import SchemaTree from './SchemaTree.svelte';

	let { entry }: { entry: ApiCatalogEntry } = $props();

	const exampleText = $derived.by(() => {
		if (!entry.response) return null;
		try {
			return JSON.stringify({ data: exampleFromSchema(entry.response) }, null, 2);
		} catch {
			return null;
		}
	});

	async function copyExample() {
		if (!exampleText) return;
		try {
			await navigator.clipboard.writeText(exampleText);
			toast.success('Beispiel kopiert');
		} catch {
			toast.error('Beispiel konnte nicht kopiert werden.');
		}
	}
</script>

<div class="space-y-4">
	<p class="text-sm">
		<span class="font-medium">Erfolg: <span class="tabular-nums">{entry.successStatus}</span></span>
		<span class="text-muted-foreground">
			– Antwort hat die Form <code class="font-mono text-xs text-foreground">{'{ data: … }'}</code>
		</span>
	</p>

	{#if entry.response}
		<SchemaTree schema={entry.response} />
	{:else}
		<p class="text-sm text-muted-foreground">Antwort-Schema nicht dokumentiert.</p>
	{/if}

	{#if exampleText}
		<div class="space-y-1.5">
			<div class="flex items-center justify-between gap-2">
				<span class="text-sm font-medium">Beispiel</span>
				<Button variant="ghost" size="sm" onclick={copyExample}>
					<Copy class="size-4" aria-hidden="true" />
					Kopieren
				</Button>
			</div>
			<pre
				class="max-h-80 overflow-x-auto overflow-y-auto rounded-md border bg-muted/50 p-3 font-mono text-xs">{exampleText}</pre>
		</div>
	{/if}

	<p class="text-xs text-muted-foreground">
		Jede Antwort enthält den Header <code class="font-mono text-foreground">x-request-id</code>
		(für Rückfragen und das API-Protokoll); bei begrenzten Endpunkten zeigt
		<code class="font-mono text-foreground">x-ratelimit-remaining</code> die verbleibenden Aufrufe im
		aktuellen Zeitfenster.
	</p>
</div>
