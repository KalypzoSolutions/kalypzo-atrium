<script lang="ts">
	import { intlLocale, t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { DataTable, PageHeader, Pagination, PageTitle } from '$lib/components/layout';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let q = $state(data.filter.q);
	// svelte-ignore state_referenced_locally
	let action = $state(data.filter.action);
	// svelte-ignore state_referenced_locally
	let from = $state(data.filter.from);
	// svelte-ignore state_referenced_locally
	let to = $state(data.filter.to);
	let expanded = $state<Record<string, boolean>>({});

	function apply(page = 1) {
		const p = new URLSearchParams();
		if (q.trim()) p.set('q', q.trim());
		if (action.trim()) p.set('action', action.trim());
		if (from) p.set('from', from);
		if (to) p.set('to', to);
		if (page > 1) p.set('page', String(page));
		goto(`?${p}`, { keepFocus: true });
	}

	function reset() {
		q = action = from = to = '';
		apply(1);
	}

	function fmt(d: Date) {
		return new Date(d).toLocaleString(intlLocale());
	}
	function hasMeta(m: Record<string, unknown>) {
		return Object.keys(m ?? {}).length > 0;
	}
</script>

<PageTitle title={t('admin-audit.title')} />

<div class="space-y-6">
	<PageHeader title={t('admin-audit.title')} description={t('admin-audit.description')} />

	<DataTable
		mobile="cards"
		caption={t('admin-audit.title')}
		empty={data.rows.length === 0}
		emptyTitle={t('admin-audit.empty')}
	>
		{#snippet toolbar()}
			<form
				class="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
				role="search"
				onsubmit={(e) => {
					e.preventDefault();
					apply(1);
				}}
			>
				<div class="space-y-1.5">
					<Label for="a-q">{t('admin-audit.search')}</Label>
					<Input id="a-q" bind:value={q} placeholder={t('admin-audit.searchPlaceholder')} />
				</div>
				<div class="space-y-1.5">
					<Label for="a-action">{t('admin-audit.actionPrefix')}</Label>
					<Input id="a-action" bind:value={action} placeholder="core.user" />
				</div>
				<div class="space-y-1.5">
					<Label for="a-from">{t('admin-audit.from')}</Label>
					<Input id="a-from" type="date" bind:value={from} />
				</div>
				<div class="space-y-1.5">
					<Label for="a-to">{t('admin-audit.to')}</Label>
					<Input id="a-to" type="date" bind:value={to} />
				</div>
				<div class="flex gap-2">
					<Button type="submit">{t('admin-audit.filter')}</Button>
					<Button type="button" variant="outline" onclick={reset}>{t('admin-audit.reset')}</Button>
				</div>
			</form>
		{/snippet}
		{#snippet head()}
			<Table.Row>
				<Table.Head>{t('admin-audit.time')}</Table.Head>
				<Table.Head>{t('admin-audit.action')}</Table.Head>
				<Table.Head>{t('admin-audit.actor')}</Table.Head>
				<Table.Head>{t('admin-audit.target')}</Table.Head>
				<Table.Head>{t('admin-audit.ip')}</Table.Head>
				<Table.Head class="text-right">{t('admin-audit.details')}</Table.Head>
			</Table.Row>
		{/snippet}
		{#each data.rows as r (r.id)}
			<Table.Row>
				<Table.Cell class="whitespace-nowrap">{fmt(r.createdAt)}</Table.Cell>
				<Table.Cell><code class="text-xs">{r.action}</code></Table.Cell>
				<Table.Cell>
					{r.actorName ?? '–'}
					{#if r.actorType !== 'user'}
						<Badge variant="secondary" class="ml-1">{r.actorType}</Badge>
					{/if}
				</Table.Cell>
				<Table.Cell class="max-w-48 truncate" title={r.target ?? ''}>{r.target ?? '–'}</Table.Cell>
				<Table.Cell>{r.ip ?? '–'}</Table.Cell>
				<Table.Cell class="text-right">
					{#if hasMeta(r.metadata)}
						<Button
							size="sm"
							variant="ghost"
							aria-expanded={!!expanded[r.id]}
							onclick={() => (expanded = { ...expanded, [r.id]: !expanded[r.id] })}
						>
							{expanded[r.id] ? t('admin-audit.hide') : t('admin-audit.show')}
						</Button>
					{/if}
				</Table.Cell>
			</Table.Row>
			{#if expanded[r.id]}
				<Table.Row>
					<Table.Cell colspan={6} class="bg-muted/40">
						<pre class="overflow-x-auto text-xs">{JSON.stringify(r.metadata, null, 2)}</pre>
						{#if r.requestId}
							<p class="mt-1 text-xs text-muted-foreground">
								{t('admin-audit.requestId', { id: r.requestId })}
							</p>
						{/if}
					</Table.Cell>
				</Table.Row>
			{/if}
		{/each}
		{#snippet footer()}
			<Pagination total={data.total} limit={data.pageSize} pageParam="page" />
		{/snippet}
	</DataTable>
</div>
