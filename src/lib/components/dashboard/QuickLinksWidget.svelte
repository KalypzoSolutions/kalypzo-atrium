<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Zap from '@lucide/svelte/icons/zap';
	import { DashboardCard, iconFor } from '$lib/components/layout';
	import type { ModuleNavEntry } from '$lib/components/layout/nav';
	import type { DashboardWidgetProps } from '$lib/sdk/types/module-ui';

	let { onstatus }: DashboardWidgetProps = $props();

	/** Modul-Navigation aus dem Root-Layout, ohne Verwaltungseinträge */
	const links = $derived(
		((page.data.navigation ?? []) as ModuleNavEntry[]).filter((n) => !n.admin)
	);

	onMount(() => {
		onstatus?.(links.length ? 'ready' : 'empty');
	});
</script>

<DashboardCard title="Schnellzugriff" icon={Zap} empty={!links.length} emptyText="Keine Module.">
	<ul class="grid grid-cols-1 gap-1 min-[400px]:grid-cols-2 md:grid-cols-1">
		{#each links as l (l.path)}
			{@const Icon = iconFor(l.icon)}
			<li>
				<a
					href={l.path}
					class="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				>
					<Icon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span class="truncate">{l.label}</span>
				</a>
			</li>
		{/each}
	</ul>
</DashboardCard>
