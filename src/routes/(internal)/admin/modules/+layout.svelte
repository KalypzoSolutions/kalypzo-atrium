<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LinkTabs, PageHeader } from '$lib/components/layout';
	import { adminTabs } from '$lib/components/layout/admin-registry';
	import { t } from '$lib/i18n';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const tabs = $derived([
		{ label: t('admin-modules.tabInstalled'), href: '/admin/modules', icon: 'puzzle' },
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
			title={t('admin-modules.headerTitle')}
			description={t('admin-modules.headerDescription')}
		/>
		<LinkTabs {tabs} label={t('admin-modules.tabsLabel')} />
	</div>
	{@render children()}
</div>
