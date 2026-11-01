<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LinkTabs, PageHeader } from '$lib/components/layout';
	import { t } from '$lib/i18n';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<PageHeader title={t('admin-settings.title')} description={t('admin-settings.description')} />

<div class="space-y-6">
	<LinkTabs tabs={data.settingsTabs} label={t('admin-settings.tabsLabel')} />
	{@render children()}
</div>
