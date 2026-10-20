<script lang="ts">
	import { onMount } from 'svelte';
	import ChartBar from '@lucide/svelte/icons/chart-bar';
	import { DashboardCard } from '$lib/components/layout';
	import type { DashboardWidgetProps } from '$lib/sdk/types/module-ui';
	import { loadCoreDashboard } from './core-data';

	let { onstatus }: DashboardWidgetProps = $props();

	let loading = $state(true);
	let error = $state('');
	let stats = $state<{ key: string; label: string; value: number; href: string }[]>([]);
	const fmt = new Intl.NumberFormat('de-DE');

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
					label: 'Aktive Benutzer*innen',
					value: d.users,
					href: '/admin/users'
				});
			if (d.modules !== undefined)
				next.push({
					key: 'modules',
					label: 'Aktive Module',
					value: d.modules,
					href: '/admin/modules'
				});
			if (d.apiKeys !== undefined)
				next.push({ key: 'keys', label: 'Aktive API-Keys', value: d.apiKeys, href: '/admin/api' });
			stats = next;
			onstatus?.(next.length ? 'ready' : 'empty');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Die Kennzahlen konnten nicht geladen werden.';
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
	title="Kennzahlen"
	icon={ChartBar}
	{loading}
	{error}
	onretry={() => load(true)}
	skeletonRows={1}
	empty={!stats.length}
	emptyText="Keine Kennzahlen verfügbar."
>
	<ul class="grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
		{#each stats as s (s.key)}
			<li>
				<a
					href={s.href}
					class="flex h-full flex-col gap-1 rounded-md border p-3 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				>
					<span class="text-2xl font-semibold tabular-nums">{fmt.format(s.value)}</span>
					<span class="text-xs text-muted-foreground">{s.label}</span>
				</a>
			</li>
		{/each}
	</ul>
</DashboardCard>
