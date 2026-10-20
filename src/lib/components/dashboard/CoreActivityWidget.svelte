<script lang="ts">
	import { onMount } from 'svelte';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import { DashboardCard } from '$lib/components/layout';
	import type { DashboardWidgetProps } from '$lib/sdk/types/module-ui';
	import { loadCoreDashboard, type CoreActivityEntry } from './core-data';

	let { onstatus }: DashboardWidgetProps = $props();

	let loading = $state(true);
	let error = $state('');
	let entries = $state<CoreActivityEntry[]>([]);
	const fmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

	async function load(fresh = false) {
		loading = true;
		error = '';
		onstatus?.('loading');
		try {
			entries = (await loadCoreDashboard(fresh)).recent ?? [];
			onstatus?.(entries.length ? 'ready' : 'empty');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Die Aktivitäten konnten nicht geladen werden.';
			onstatus?.('error');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
	});
</script>

<DashboardCard
	title="Letzte Aktivitäten"
	icon={ScrollText}
	href="/admin/audit"
	{loading}
	{error}
	onretry={() => load(true)}
	empty={!entries.length}
	emptyText="Noch keine Einträge."
>
	<ul class="divide-y">
		{#each entries as e (e.id)}
			<li class="flex items-start justify-between gap-3 py-2">
				<div class="min-w-0">
					<p class="truncate font-mono text-xs">{e.action}</p>
					<p class="truncate text-xs text-muted-foreground">
						{e.actorName ?? 'System'}{e.target ? ` · ${e.target}` : ''}
					</p>
				</div>
				<time
					class="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
					datetime={e.createdAt}
				>
					{fmt.format(new Date(e.createdAt))}
				</time>
			</li>
		{/each}
	</ul>
</DashboardCard>
