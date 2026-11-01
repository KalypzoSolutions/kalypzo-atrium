<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import DataTable from '$lib/components/layout/DataTable.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import { t } from '$lib/i18n';
	import { formatDateTime } from '$lib/i18n/intl';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const ACTION: Record<string, string> = {
		install: 'admin-modules.history.action.install',
		update: 'admin-modules.history.action.update',
		reinstall: 'admin-modules.history.action.reinstall',
		downgrade: 'admin-modules.history.action.downgrade',
		uninstall: 'admin-modules.history.action.uninstall'
	};
	const STATUS: Record<string, { label: string; variant: 'success' | 'destructive' | 'info' }> = {
		done: { label: 'admin-modules.history.status.done', variant: 'success' },
		failed: { label: 'admin-modules.history.status.failed', variant: 'destructive' },
		requested: { label: 'admin-modules.history.status.requested', variant: 'info' }
	};

	function sourceText(type: string | null, source: Record<string, unknown>): string {
		if (type === 'github') {
			return `github:${source.owner}/${source.repo}${source.path ? `/${source.path}` : ''}${source.ref ? `#${source.ref}` : ''}`;
		}
		if (type === 'upload')
			return t('admin-modules.history.zip', { name: String(source.fileName ?? '') });
		return type ?? '–';
	}
</script>

<PageTitle title={t('admin-modules.history.title')} />

<div class="space-y-6">
	<DataTable
		title={t('admin-modules.history.sourcesTitle')}
		titleLevel={2}
		caption={t('admin-modules.history.sourcesTitle')}
		mobile="cards"
		empty={!data.installed.length}
		emptyTitle={t('admin-modules.history.sourcesEmpty')}
		emptyDescription={t('admin-modules.history.sourcesEmptyDescription')}
	>
		{#snippet head()}
			<Table.Row>
				<Table.Head>{t('admin-modules.history.colModule')}</Table.Head>
				<Table.Head>{t('admin-modules.history.colVersion')}</Table.Head>
				<Table.Head>{t('admin-modules.history.colSource')}</Table.Head>
				<Table.Head>{t('admin-modules.history.colCommit')}</Table.Head>
				<Table.Head>{t('admin-modules.history.colInstalled')}</Table.Head>
			</Table.Row>
		{/snippet}
		{#each data.installed as m (m.id)}
			<Table.Row>
				<Table.Cell><code>{m.id}</code></Table.Cell>
				<Table.Cell>{m.version}</Table.Cell>
				<Table.Cell class="break-all"><code>{sourceText(m.sourceType, m.source)}</code></Table.Cell>
				<Table.Cell><code>{m.commit?.slice(0, 10) ?? '–'}</code></Table.Cell>
				<Table.Cell>{formatDateTime(m.installedAt)}</Table.Cell>
			</Table.Row>
		{/each}
	</DataTable>

	<DataTable
		title={t('admin-modules.history.eventsTitle')}
		titleLevel={2}
		caption={t('admin-modules.history.eventsCaption')}
		mobile="cards"
		empty={!data.events.length}
		emptyTitle={t('admin-modules.history.eventsEmpty')}
	>
		{#snippet head()}
			<Table.Row>
				<Table.Head>{t('admin-modules.history.colTime')}</Table.Head>
				<Table.Head>{t('admin-modules.history.colModule')}</Table.Head>
				<Table.Head>{t('admin-modules.history.colAction')}</Table.Head>
				<Table.Head>{t('admin-modules.history.colVersion')}</Table.Head>
				<Table.Head>{t('admin-modules.history.colSource')}</Table.Head>
				<Table.Head>{t('admin-modules.history.colActor')}</Table.Head>
				<Table.Head>{t('admin-modules.history.colStatus')}</Table.Head>
			</Table.Row>
		{/snippet}
		{#each data.events as e (e.id)}
			<Table.Row>
				<Table.Cell class="whitespace-nowrap">{formatDateTime(e.createdAt)}</Table.Cell>
				<Table.Cell><code>{e.moduleId}</code></Table.Cell>
				<Table.Cell>{ACTION[e.action] ? t(ACTION[e.action]!) : e.action}</Table.Cell>
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
						>{STATUS[e.status] ? t(STATUS[e.status]!.label) : e.status}</Badge
					>
					{#if e.status === 'failed' && e.detail}
						<span class="block text-xs text-destructive">{e.detail}</span>
					{/if}
				</Table.Cell>
			</Table.Row>
		{/each}
	</DataTable>
</div>
