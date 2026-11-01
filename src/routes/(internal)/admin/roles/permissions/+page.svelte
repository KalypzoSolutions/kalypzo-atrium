<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import DataTable from '$lib/components/layout/DataTable.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const groups = $derived.by(() => {
		const map = new Map<string, PageData['permissions']>();
		for (const p of data.permissions) map.set(p.moduleId, [...(map.get(p.moduleId) ?? []), p]);
		return [...map.entries()];
	});
</script>

<PageTitle title={t('admin-roles.permissions.title')} />

<div class="space-y-6">
	<div>
		<h2 class="text-section">{t('admin-roles.permissions.title')}</h2>
		<p class="text-sm text-muted-foreground">
			{t('admin-roles.permissions.introBefore')}
			<code>{t('admin-roles.permissions.scheme')}</code>{t('admin-roles.permissions.introAfter')}
		</p>
	</div>

	{#each groups as [moduleId, items] (moduleId)}
		<DataTable
			caption={t('admin-roles.permissions.caption', {
				module: data.moduleNames[moduleId] ?? moduleId
			})}
			title={data.moduleNames[moduleId] ?? moduleId}
			description={t('admin-roles.permissions.groupDescription', {
				count: items.length,
				id: moduleId
			})}
			mobile="cards"
		>
			{#snippet head()}
				<Table.Row>
					<Table.Head>{t('admin-roles.permissions.key')}</Table.Head>
					<Table.Head>{t('admin-roles.permissions.description')}</Table.Head>
					<Table.Head>{t('admin-roles.permissions.roles')}</Table.Head>
				</Table.Row>
			{/snippet}
			{#each items as p (p.key)}
				<Table.Row>
					<Table.Cell><code class="text-xs">{p.key}</code></Table.Cell>
					<Table.Cell class="whitespace-normal">{p.description ?? '–'}</Table.Cell>
					<Table.Cell>
						<div class="flex flex-wrap gap-1">
							{#each p.roles as r (r)}<Badge variant="secondary">{r}</Badge>{/each}
							{#if !p.roles.length}<span class="text-muted-foreground"
									>{t('admin-roles.permissions.none')}</span
								>{/if}
						</div>
					</Table.Cell>
				</Table.Row>
			{/each}
		</DataTable>
	{/each}
</div>
