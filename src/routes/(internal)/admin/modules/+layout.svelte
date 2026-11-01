<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LinkTabs, PageHeader } from '$lib/components/layout';
	import { adminTabs } from '$lib/components/layout/admin-registry';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const tabs = $derived([
		{ label: 'Installiert', href: '/admin/modules', icon: 'puzzle' },
		...adminTabs('modules', data.permissions).map((e) => ({
			label: e.label,
			href: e.href,
			icon: e.icon
		}))
	]);
</script>

<div class="space-y-6">
	<div>
		<PageHeader
			title="Module"
			description="Module aktivieren und deaktivieren, aus GitHub oder einer ZIP-Datei installieren."
		/>
		<LinkTabs {tabs} label="Bereiche der Module" />
	</div>
	{@render children()}
</div>
