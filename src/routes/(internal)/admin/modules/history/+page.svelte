<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import DataTable from '$lib/components/layout/DataTable.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import { formatDateTimeDe } from '$lib/sdk/dates';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const ACTION: Record<string, string> = {
		install: 'Installiert',
		update: 'Aktualisiert',
		reinstall: 'Neu eingespielt',
		downgrade: 'Ältere Version',
		uninstall: 'Entfernt'
	};
	const STATUS: Record<string, { label: string; variant: 'success' | 'destructive' | 'info' }> = {
		done: { label: 'Fertig', variant: 'success' },
		failed: { label: 'Fehlgeschlagen', variant: 'destructive' },
		requested: { label: 'Angefordert', variant: 'info' }
	};

	function sourceText(type: string | null, source: Record<string, unknown>): string {
		if (type === 'github') {
			return `github:${source.owner}/${source.repo}${source.path ? `/${source.path}` : ''}${source.ref ? `#${source.ref}` : ''}`;
		}
		if (type === 'upload') return `ZIP ${source.fileName ?? ''}`;
		return type ?? '–';
	}
</script>

<PageTitle title="Modul-Verlauf" />

<div class="space-y-6">
	<DataTable
		title="Installierte Quellen"
		titleLevel={2}
		caption="Installierte Quellen"
		mobile="cards"
		empty={!data.installed.length}
		emptyTitle="Noch keine Module aus einer Quelle installiert."
		emptyDescription="Die Module dieses Servers stammen aus dem Build."
	>
		{#snippet head()}
			<Table.Row>
				<Table.Head>Modul</Table.Head>
				<Table.Head>Version</Table.Head>
				<Table.Head>Quelle</Table.Head>
				<Table.Head>Commit</Table.Head>
				<Table.Head>Installiert</Table.Head>
			</Table.Row>
		{/snippet}
		{#each data.installed as m (m.id)}
			<Table.Row>
				<Table.Cell><code>{m.id}</code></Table.Cell>
				<Table.Cell>{m.version}</Table.Cell>
				<Table.Cell class="break-all"><code>{sourceText(m.sourceType, m.source)}</code></Table.Cell>
				<Table.Cell><code>{m.commit?.slice(0, 10) ?? '–'}</code></Table.Cell>
				<Table.Cell>{formatDateTimeDe(m.installedAt)}</Table.Cell>
			</Table.Row>
		{/each}
	</DataTable>

	<DataTable
		title="Verlauf"
		titleLevel={2}
		caption="Verlauf der Installationen"
		mobile="cards"
		empty={!data.events.length}
		emptyTitle="Noch keine Installationen."
	>
		{#snippet head()}
			<Table.Row>
				<Table.Head>Zeit</Table.Head>
				<Table.Head>Modul</Table.Head>
				<Table.Head>Vorgang</Table.Head>
				<Table.Head>Version</Table.Head>
				<Table.Head>Quelle</Table.Head>
				<Table.Head>Durch</Table.Head>
				<Table.Head>Status</Table.Head>
			</Table.Row>
		{/snippet}
		{#each data.events as e (e.id)}
			<Table.Row>
				<Table.Cell class="whitespace-nowrap">{formatDateTimeDe(e.createdAt)}</Table.Cell>
				<Table.Cell><code>{e.moduleId}</code></Table.Cell>
				<Table.Cell>{ACTION[e.action] ?? e.action}</Table.Cell>
				<Table.Cell>{e.fromVersion ? `${e.fromVersion} → ` : ''}{e.toVersion ?? '–'}</Table.Cell>
				<Table.Cell class="break-all">
					<code>{sourceText(e.sourceType, e.source)}</code>
					{#if e.commit}<span class="block text-xs text-muted-foreground"
							>{e.commit.slice(0, 10)}</span
						>{/if}
				</Table.Cell>
				<Table.Cell>{e.actor}</Table.Cell>
				<Table.Cell>
					<Badge variant={STATUS[e.status]?.variant ?? 'info'}
						>{STATUS[e.status]?.label ?? e.status}</Badge
					>
					{#if e.status === 'failed' && e.detail}
						<span class="block text-xs text-destructive">{e.detail}</span>
					{/if}
				</Table.Cell>
			</Table.Row>
		{/each}
	</DataTable>
</div>
