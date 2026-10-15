<script lang="ts">
	import { DataTable, EmptyState, PageHeader } from '$lib/components/layout';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { TableCell, TableHead, TableRow } from '$lib/components/ui/table';

	let { data } = $props();
	const fmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'medium' });
</script>

<svelte:head><title>Dashboard - {data.systemName}</title></svelte:head>

<PageHeader title="Dashboard" description="Willkommen, {data.user?.name}." />

{#if data.stats.length}
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		{#each data.stats as s (s.key)}
			<Card>
				<CardHeader class="pb-2">
					<CardTitle class="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
				</CardHeader>
				<CardContent>
					{#if s.href}
						<a href={s.href} class="text-3xl font-semibold hover:underline">{s.value}</a>
					{:else}
						<p class="text-3xl font-semibold">{s.value}</p>
					{/if}
				</CardContent>
			</Card>
		{/each}
	</div>
{/if}

{#if data.recent}
	<div class="mt-6">
		<DataTable
			caption="Letzte Aktivitäten"
			title="Letzte Aktivitäten"
			empty={data.recent.length === 0}
			emptyTitle="Noch keine Einträge"
		>
			{#snippet head()}
				<TableRow>
					<TableHead>Zeitpunkt</TableHead>
					<TableHead>Aktion</TableHead>
					<TableHead>Akteur</TableHead>
					<TableHead class="hidden md:table-cell">Ziel</TableHead>
				</TableRow>
			{/snippet}
			{#each data.recent as r (r.id)}
				<TableRow>
					<TableCell class="whitespace-nowrap">{fmt.format(new Date(r.createdAt))}</TableCell>
					<TableCell class="font-mono text-xs">{r.action}</TableCell>
					<TableCell>{r.actorName ?? '-'}</TableCell>
					<TableCell class="hidden max-w-48 truncate md:table-cell">{r.target ?? ''}</TableCell>
				</TableRow>
			{/each}
		</DataTable>
	</div>
{:else if data.stats.length === 0}
	<EmptyState
		title="Keine Uebersicht verfuegbar"
		description="Ihre Rollen enthalten keine Berechtigungen fuer Dashboard-Kennzahlen."
	/>
{/if}
