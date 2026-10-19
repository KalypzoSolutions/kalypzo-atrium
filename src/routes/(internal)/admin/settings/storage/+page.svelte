<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { DataTable } from '$lib/components/layout';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { submitHandler } from '../../_shared/form-utils';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let testing = $state(false);
	const testHandler = submitHandler({ busy: (b) => (testing = b), reload: false });

	const nf = new Intl.NumberFormat('de-DE');
	function size(bytes: number) {
		if (bytes < 1024) return `${bytes} B`;
		const units = ['KB', 'MB', 'GB', 'TB'];
		let v = bytes / 1024;
		let i = 0;
		while (v >= 1024 && i < units.length - 1) {
			v /= 1024;
			i++;
		}
		return `${v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${units[i]}`;
	}
</script>

<svelte:head><title>Speicher · Einstellungen</title></svelte:head>

<div class="space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>S3-Storage</Card.Title>
			<Card.Description>
				Anbindung an AWS S3, Cloudflare R2, MinIO oder andere S3-kompatible Dienste. Zugangsdaten
				werden verschlüsselt gespeichert und nie an den Browser übertragen.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<SettingsForm fields={data.fields} canEdit={true} />
			<form method="POST" action="?/test" use:enhance={testHandler}>
				<Button type="submit" variant="outline" disabled={testing}>
					{testing ? 'Teste …' : 'Verbindung testen'}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<DataTable
		caption="Speicherverbrauch je Modul"
		title="Speicherverbrauch je Modul"
		empty={data.usage.length === 0}
		emptyTitle="Noch keine Dateien gespeichert."
	>
		{#snippet head()}
			<Table.Row>
				<Table.Head>Modul</Table.Head>
				<Table.Head class="text-right">Dateien</Table.Head>
				<Table.Head class="text-right">Größe</Table.Head>
			</Table.Row>
		{/snippet}
		{#each data.usage as u (u.moduleId)}
			<Table.Row>
				<Table.Cell class="font-medium">{u.moduleId}</Table.Cell>
				<Table.Cell class="text-right">{nf.format(u.files)}</Table.Cell>
				<Table.Cell class="text-right">{size(u.bytes)}</Table.Cell>
			</Table.Row>
		{/each}
	</DataTable>
</div>
