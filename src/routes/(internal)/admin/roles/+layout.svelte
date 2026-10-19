<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LinkTabs, PageHeader } from '$lib/components/layout';
	import { adminTabs } from '$lib/components/layout/admin-registry';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const tabs = $derived([
		{ label: 'Rollen', href: '/admin/roles', icon: 'shield' },
		...adminTabs('roles', data.permissions).map((e) => ({
			label: e.label,
			href: e.href,
			icon: e.icon
		}))
	]);
</script>

<div class="space-y-6">
	<div>
		<PageHeader
			title="Rollen & Berechtigungen"
			description="Rollen bündeln Rechte und werden Benutzer*innen zugewiesen."
		/>
		<LinkTabs {tabs} label="Bereiche von Rollen & Berechtigungen" />
	</div>
	{@render children()}
</div>
