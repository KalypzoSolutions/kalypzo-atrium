<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatNumber } from '$lib/i18n/intl';
	import { onMount } from 'svelte';
	import ChartBar from '@lucide/svelte/icons/chart-bar';
	import { DashboardCard } from '$lib/components/layout';
	import type { DashboardWidgetProps } from '$lib/sdk/types/module-ui';
	import { loadCoreDashboard } from './core-data';

	let { onstatus }: DashboardWidgetProps = $props();

	let loading = $state(true);
	let error = $state('');
	let stats = $state<{ key: string; label: string; value: number; href: string }[]>([]);

	async function load(fresh = false) {
		loading = true;
		error = '';
		onstatus?.('loading');
		try {
			const d = await loadCoreDashboard(fresh);
			const next: typeof stats = [];
			if (d.users !== undefined)
				next.push({
					key: 'users',
					label: t('widgets.stats.users'),
					value: d.users,
					href: '/admin/users'
				});
			if (d.modules !== undefined)
				next.push({
					key: 'modules',
					label: t('widgets.stats.modules'),
					value: d.modules,
					href: '/admin/modules'
				});
			if (d.apiKeys !== undefined)
				next.push({
					key: 'keys',
					label: t('widgets.stats.apiKeys'),
					value: d.apiKeys,
					href: '/admin/api'
				});
			stats = next;
			onstatus?.(next.length ? 'ready' : 'empty');
		} catch (e) {
			error = e instanceof Error ? e.message : t('widgets.stats.loadFailed');
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
	title={t('widgets.stats.title')}
	icon={ChartBar}
	{loading}
	{error}
	onretry={() => load(true)}
	skeletonRows={1}
	empty={!stats.length}
	emptyText={t('widgets.stats.empty')}
>
	<ul class="grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
		{#each stats as s (s.key)}
			<li>
				<a
					href={s.href}
					class="flex h-full flex-col gap-1 rounded-md border p-3 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				>
					<span class="text-2xl font-semibold tabular-nums">{formatNumber(s.value)}</span>
					<span class="text-xs text-muted-foreground">{s.label}</span>
				</a>
			</li>
		{/each}
	</ul>
</DashboardCard>
