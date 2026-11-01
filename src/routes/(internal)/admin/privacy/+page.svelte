<script lang="ts">
	import { t } from '$lib/i18n';
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

<PageHeader title={t('admin-privacy.title')} description={t('admin-privacy.description')} />

<Alert variant="warning" class="mb-4">
	<AlertDescription>
		{t('admin-privacy.warning')}
	</AlertDescription>
</Alert>

<form class="mb-4 flex flex-wrap items-end gap-2" onsubmit={search}>
	<div class="grid min-w-64 flex-1 gap-1.5">
		<Label for="privacy-q">{t('admin-privacy.searchLabel')}</Label>
		<Input
			id="privacy-q"
			bind:value={q}
			placeholder={t('admin-privacy.searchPlaceholder')}
			autocomplete="off"
		/>
	</div>
	<Button type="submit">{t('admin-privacy.search')}</Button>
</form>

{#if data.q.length >= 2}
	<DataTable
		caption={t('admin-privacy.caption')}
		mobile="cards"
		empty={data.candidates.length === 0}
		emptyTitle={t('admin-privacy.emptyTitle')}
		emptyDescription={t('admin-privacy.emptyDescription')}
	>
		{#snippet head()}
			<Table.Row>
				<Table.Head>{t('admin-privacy.person')}</Table.Head>
				<Table.Head>{t('admin-privacy.source')}</Table.Head>
				<Table.Head class="text-right">{t('admin-privacy.export')}</Table.Head>
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
							<FileDown />
							{t('admin-privacy.exportButton')}
						</Button>
					</form>
				</Table.Cell>
			</Table.Row>
		{/each}
	</DataTable>
{/if}

<p class="mt-4 max-w-3xl text-xs text-muted-foreground">
	{t('admin-privacy.footnote')}
</p>
