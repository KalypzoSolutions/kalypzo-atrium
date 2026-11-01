<script lang="ts">
	import { DataTable, PageTitle } from '$lib/components/layout';
	import * as Alert from '$lib/components/ui/alert';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { intlLocale, t } from '$lib/i18n';
	import { formatNumber } from '$lib/i18n/intl';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const nf = { format: (v: number) => formatNumber(v) };
	const usd = new Intl.NumberFormat(intlLocale(), {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 4
	});
	const month = new Date().toLocaleDateString(intlLocale(), {
		month: 'long',
		year: 'numeric',
		timeZone: 'Europe/Berlin'
	});

	/** Einstellungen der Schreibhilfe (Stil, heikle Daten, Limit je Person) eigene Karte */
	const isAssistKey = (key: string) =>
		key.startsWith('core.ai.style.') ||
		key.startsWith('core.ai.assist.') ||
		key === 'core.ai.userMonthlyTokenLimit';
	const configFields = $derived(data.fields.filter((f) => !isAssistKey(f.key)));
	const assistFields = $derived(data.fields.filter((f) => isAssistKey(f.key)));
</script>

<PageTitle title={t('admin-settings.ai.pageTitle')} />

<div class="space-y-6">
	<p class="text-sm text-muted-foreground">
		{t('admin-settings.ai.intro')}
	</p>

	<!-- #69: Übermittlung an Dritte -->
	<Alert.Root variant="warning">
		<Alert.Title>{t('admin-settings.ai.privacyTitle')}</Alert.Title>
		<Alert.Description>
			<p>{t('admin-settings.ai.privacyText1')}</p>
			<p>{t('admin-settings.ai.privacyText2')}</p>
		</Alert.Description>
	</Alert.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>{t('admin-settings.ai.usageTitle', { month })}</Card.Title>
			<Card.Description>
				{t('admin-settings.ai.usageDescription')}
				{#if data.limits.tokens > 0}{t('admin-settings.ai.tokenLimit', {
						limit: nf.format(data.limits.tokens)
					})}{/if}
				{#if data.limits.costUsd > 0}{t('admin-settings.ai.costLimit', {
						limit: usd.format(data.limits.costUsd)
					})}{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<div>
					<dt class="text-xs text-muted-foreground">{t('admin-settings.ai.requests')}</dt>
					<dd class="text-xl font-semibold">{nf.format(data.totals.requests)}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">{t('admin-settings.ai.inputTokens')}</dt>
					<dd class="text-xl font-semibold">{nf.format(data.totals.inputTokens)}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">{t('admin-settings.ai.outputTokens')}</dt>
					<dd class="text-xl font-semibold">{nf.format(data.totals.outputTokens)}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">{t('admin-settings.ai.estimatedCost')}</dt>
					<dd class="text-xl font-semibold">{usd.format(data.totals.costUsd)}</dd>
				</div>
			</dl>
		</Card.Content>
	</Card.Root>

	<DataTable
		caption={t('admin-settings.ai.tableCaption')}
		title={t('admin-settings.ai.tableTitle')}
		empty={data.usage.length === 0}
		emptyTitle={t('admin-settings.ai.tableEmpty')}
	>
		{#snippet head()}
			<Table.Row>
				<Table.Head>{t('admin-settings.ai.colModule')}</Table.Head>
				<Table.Head>{t('admin-settings.ai.colModel')}</Table.Head>
				<Table.Head class="text-right">{t('admin-settings.ai.requests')}</Table.Head>
				<Table.Head class="text-right">{t('admin-settings.ai.colInput')}</Table.Head>
				<Table.Head class="text-right">{t('admin-settings.ai.colOutput')}</Table.Head>
				<Table.Head class="text-right">{t('admin-settings.ai.colCost')}</Table.Head>
			</Table.Row>
		{/snippet}
		{#each data.usage as r (r.moduleId + r.model)}
			<Table.Row>
				<Table.Cell class="font-medium">{r.moduleId}</Table.Cell>
				<Table.Cell>{r.model}</Table.Cell>
				<Table.Cell class="text-right">{nf.format(r.requests)}</Table.Cell>
				<Table.Cell class="text-right">{nf.format(r.inputTokens)}</Table.Cell>
				<Table.Cell class="text-right">{nf.format(r.outputTokens)}</Table.Cell>
				<Table.Cell class="text-right">{usd.format(r.costUsd)}</Table.Cell>
			</Table.Row>
		{/each}
	</DataTable>

	{#if data.canManage}
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('admin-settings.ai.configTitle')}</Card.Title>
				<Card.Description>
					{t('admin-settings.ai.configDescription')}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<SettingsForm fields={configFields} canEdit={true} />
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>{t('admin-settings.ai.assistTitle')}</Card.Title>
				<Card.Description>
					{t('admin-settings.ai.assistDescription')}
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<Alert.Root variant="info">
					<Alert.Description>
						{t('admin-settings.ai.assistPrivacy')}
					</Alert.Description>
				</Alert.Root>
				<SettingsForm fields={assistFields} canEdit={true} />
			</Card.Content>
		</Card.Root>
	{/if}
</div>
