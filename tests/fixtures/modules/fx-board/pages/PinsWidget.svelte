<script lang="ts">
	import { onMount } from 'svelte';
	import { DashboardCard } from '$lib/components/layout';
	import type { DashboardWidgetProps } from '$lib/sdk/types/module-ui';

	let { onstatus }: DashboardWidgetProps = $props();
	onMount(() => onstatus?.('empty'));
</script>

<DashboardCard title="Pinnwand">
	<p class="text-sm text-muted-foreground">Keine Einträge.</p>
</DashboardCard>
