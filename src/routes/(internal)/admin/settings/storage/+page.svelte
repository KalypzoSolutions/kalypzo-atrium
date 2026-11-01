<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { DataTable, PageTitle } from '$lib/components/layout';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { t } from '$lib/i18n';
	import { formatBytes, formatNumber } from '$lib/i18n/intl';
	import { submitHandler } from '../../_shared/form-utils';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let testing = $state(false);
	const testHandler = submitHandler({ busy: (b) => (testing = b), reload: false });
</script>

<PageTitle title={t('admin-settings.storage.pageTitle')} />

<div class="space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>{t('admin-settings.storage.title')}</Card.Title>
			<Card.Description>
				{t('admin-settings.storage.description')}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<SettingsForm fields={data.fields} canEdit={true} />
			<form method="POST" action="?/test" use:enhance={testHandler}>
				<Button type="submit" variant="outline" disabled={testing}>
					{testing ? t('admin-settings.storage.testing') : t('admin-settings.storage.test')}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<DataTable
		caption={t('admin-settings.storage.usageTitle')}
		title={t('admin-settings.storage.usageTitle')}
		empty={data.usage.length === 0}
		emptyTitle={t('admin-settings.storage.usageEmpty')}
	>
		{#snippet head()}
			<Table.Row>
				<Table.Head>{t('admin-settings.storage.colModule')}</Table.Head>
				<Table.Head class="text-right">{t('admin-settings.storage.colFiles')}</Table.Head>
				<Table.Head class="text-right">{t('admin-settings.storage.colSize')}</Table.Head>
			</Table.Row>
		{/snippet}
		{#each data.usage as u (u.moduleId)}
			<Table.Row>
				<Table.Cell class="font-medium">{u.moduleId}</Table.Cell>
				<Table.Cell class="text-right">{formatNumber(u.files)}</Table.Cell>
				<Table.Cell class="text-right">{formatBytes(u.bytes)}</Table.Cell>
			</Table.Row>
		{/each}
	</DataTable>
</div>
