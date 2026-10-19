<script lang="ts">
	import DataTable from '$lib/components/layout/DataTable.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const groups = $derived.by(() => {
		const map = new Map<string, PageData['permissions']>();
		for (const p of data.permissions) map.set(p.moduleId, [...(map.get(p.moduleId) ?? []), p]);
		return [...map.entries()];
	});
</script>

<svelte:head><title>Berechtigungen</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-semibold">Berechtigungen</h1>
		<p class="text-sm text-muted-foreground">
			Übersicht aller von Core und Modulen registrierten Berechtigungen (Schema
			<code>modul.ressource.aktion</code>).
		</p>
	</div>

	{#each groups as [moduleId, items] (moduleId)}
		<DataTable
			caption="Berechtigungen {data.moduleNames[moduleId] ?? moduleId}"
			title={data.moduleNames[moduleId] ?? moduleId}
			description="{items.length} Berechtigungen · Modul-ID {moduleId}"
			mobile="cards"
		>
			{#snippet head()}
				<Table.Row>
					<Table.Head>Schlüssel</Table.Head>
					<Table.Head>Beschreibung</Table.Head>
					<Table.Head>Rollen</Table.Head>
				</Table.Row>
			{/snippet}
			{#each items as p (p.key)}
				<Table.Row>
					<Table.Cell><code class="text-xs">{p.key}</code></Table.Cell>
					<Table.Cell class="whitespace-normal">{p.description ?? '–'}</Table.Cell>
					<Table.Cell>
						<div class="flex flex-wrap gap-1">
							{#each p.roles as r (r)}<Badge variant="secondary">{r}</Badge>{/each}
							{#if !p.roles.length}<span class="text-muted-foreground">keine</span>{/if}
						</div>
					</Table.Cell>
				</Table.Row>
			{/each}
		</DataTable>
	{/each}
</div>
