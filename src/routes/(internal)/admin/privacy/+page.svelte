<script lang="ts">
	import { goto } from '$app/navigation';
	import FileDown from '@lucide/svelte/icons/file-down';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import { DataTable, PageHeader } from '$lib/components/layout';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let q = $state(data.q);

	function search(e: SubmitEvent) {
		e.preventDefault();
		const p = new URLSearchParams();
		if (q.trim()) p.set('q', q.trim());
		goto(`?${p}`, { keepFocus: true });
	}
</script>

<PageHeader
	title="Datenauskunft"
	description="Alle gespeicherten Daten einer Person (Benutzerkonto oder Mitglied) aus allen aktiven Modulen als JSON-Datei – für Auskunft (Art. 15 DSGVO) und Datenübertragbarkeit (Art. 20)."
/>

<Alert variant="warning" class="mb-4">
	<AlertDescription>
		Die Datei enthält alle Angaben zur Person im Klartext, auch Gesundheitsdaten und – bei Kindern –
		die Daten der verknüpften Mitglieder. Nur an die betroffene Person bzw. die
		Erziehungsberechtigten herausgeben und nicht unverschlüsselt per E-Mail versenden. Jeder Export
		wird im Audit-Log vermerkt.
	</AlertDescription>
</Alert>

<form class="mb-4 flex flex-wrap items-end gap-2" onsubmit={search}>
	<div class="grid min-w-64 flex-1 gap-1.5">
		<Label for="privacy-q">Person suchen</Label>
		<Input
			id="privacy-q"
			bind:value={q}
			placeholder="Name oder E-Mail (mindestens 2 Zeichen)"
			autocomplete="off"
		/>
	</div>
	<Button type="submit">Suchen</Button>
</form>

{#if data.q.length >= 2}
	<DataTable
		caption="Gefundene Personen"
		mobile="cards"
		empty={data.candidates.length === 0}
		emptyTitle="Niemand gefunden"
		emptyDescription="Weder ein Benutzerkonto noch ein Mitglied passt zur Suche."
	>
		{#snippet head()}
			<Table.Row>
				<Table.Head>Person</Table.Head>
				<Table.Head>Quelle</Table.Head>
				<Table.Head class="text-right">Export</Table.Head>
			</Table.Row>
		{/snippet}
		{#each data.candidates as c (`${c.source}:${c.userId ?? ''}:${c.memberId ?? ''}`)}
			<Table.Row>
				<Table.Cell>
					<div class="font-medium">{c.label}</div>
					{#if c.detail}<div class="text-xs text-muted-foreground">{c.detail}</div>{/if}
				</Table.Cell>
				<Table.Cell><Badge variant="outline">{c.sourceName}</Badge></Table.Cell>
				<Table.Cell class="text-right">
					<form method="POST" action="/admin/privacy/export" class="inline">
						{#if c.userId}<input type="hidden" name="userId" value={c.userId} />{/if}
						{#if c.memberId}<input type="hidden" name="memberId" value={c.memberId} />{/if}
						<Button type="submit" size="sm" variant="outline">
							<FileDown /> Auskunft (JSON)
						</Button>
					</form>
				</Table.Cell>
			</Table.Row>
		{/each}
	</DataTable>
{/if}

<p class="mt-4 max-w-3xl text-xs text-muted-foreground">
	Benutzerkonto: Konto, Rollen, Sitzungen, API-Keys, persönliche Einstellungen, eigene
	Audit-Einträge und alle Moduldaten, auch der verknüpften Mitglieder. Mitglied: Mitgliedsdaten und
	Teilnahmen. Dateiinhalte (Dokumente, Bilder) sind nicht enthalten, nur ihre Namen.
</p>
