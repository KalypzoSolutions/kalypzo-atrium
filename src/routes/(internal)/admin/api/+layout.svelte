<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LinkTabs, PageHeader } from '$lib/components/layout';
	import { adminTabs } from '$lib/components/layout/admin-registry';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const tabs = $derived([
		{ label: 'API-Keys', href: '/admin/api', icon: 'key-round' },
		...adminTabs('api', data.permissions).map((e) => ({
			label: e.label,
			href: e.href,
			icon: e.icon
		}))
	]);
</script>

<div class="space-y-6">
	<div>
		<PageHeader
			title="Schnittstellen"
			description="API-Keys für externe Dienste und die Übersicht aller REST-Endpunkte."
		/>
		<LinkTabs {tabs} label="Bereiche der Schnittstellen" />
	</div>
	{@render children()}
</div>
