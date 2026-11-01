<script lang="ts">
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { PageHeader, PageTitle } from '$lib/components/layout';
	import * as Tabs from '$lib/components/ui/tabs';
	import ExportPanel from './ExportPanel.svelte';
	import ImportWizard from './ImportWizard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const tab = $derived(page.url.searchParams.get('tab') === 'import' ? 'import' : 'export');

	function setTab(value: string) {
		const url = new URL(page.url);
		if (value === 'import') url.searchParams.set('tab', 'import');
		else url.searchParams.delete('tab');
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}
</script>

<PageTitle title={t('admin-backup.title')} />

<div class="mx-auto max-w-4xl">
	<PageHeader title={t('admin-backup.title')} description={t('admin-backup.description')} />

	<Tabs.Root value={tab} onValueChange={setTab}>
		<Tabs.List variant="line" class="mb-4">
			<Tabs.Trigger value="export">{t('admin-backup.tabExport')}</Tabs.Trigger>
			<Tabs.Trigger value="import">{t('admin-backup.tabImport')}</Tabs.Trigger>
		</Tabs.List>
	</Tabs.Root>

	<!-- Beide Bereiche bleiben eingehängt, damit ein laufender Upload/Lauf beim Reiterwechsel weiterläuft -->
	<div hidden={tab !== 'export'}>
		<ExportPanel
			scopes={data.scopes}
			twoFactorEnabled={data.twoFactorEnabled}
			minPassword={data.constants.minPassword}
		/>
	</div>
	<div hidden={tab !== 'import'}>
		<ImportWizard
			scopes={data.scopes}
			twoFactorEnabled={data.twoFactorEnabled}
			constants={data.constants}
		/>
	</div>
</div>
