<script lang="ts">
	import { METHOD_BADGE_CLASS } from '$lib/api-docs/method-style';
	import Copy from '@lucide/svelte/icons/copy';
	import { toast } from 'svelte-sonner';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { SummaryList, type SummaryRow } from '$lib/components/layout';
	import { cn } from '$lib/utils';
	import type { ApiCatalogEntry, JsonSchema } from '$lib/api-docs/types';
	import { t } from '$lib/i18n';
	import { formatBytes, formatNumber } from '$lib/i18n/intl';
	import SchemaTree from './SchemaTree.svelte';
	import ResponsePanel from './ResponsePanel.svelte';
	import ErrorsTable from './ErrorsTable.svelte';
	import ApiConsole from './ApiConsole.svelte';

	let { entry, open = $bindable(false) }: { entry: ApiCatalogEntry | null; open: boolean } =
		$props();

	function accessText(e: ApiCatalogEntry): string {
		if (e.access === 'public') return t('api-docs.sheet.publicAccess');
		if (e.access === 'authenticated') return t('api-docs.sheet.authenticatedAccess');
		return t('api-docs.sheet.permissionAccess', { permission: e.permission ?? '–' });
	}

	function overviewRows(e: ApiCatalogEntry): SummaryRow[] {
		const rl = e.rateLimit;
		const rows: SummaryRow[] = [
			{
				label: t('api-docs.sheet.module'),
				value: e.moduleEnabled
					? e.moduleName
					: t('api-docs.sheet.moduleInactive', { name: e.moduleName })
			},
			{ label: t('api-docs.sheet.access'), value: accessText(e) },
			{
				label: t('api-docs.sheet.sessionOnly'),
				value: e.sessionOnly ? t('api-docs.sheet.yes') : t('api-docs.sheet.no'),
				hint: t('api-docs.sheet.sessionOnlyHint')
			},
			{
				label: t('api-docs.sheet.allowed'),
				value: e.allowed
					? t('api-docs.sheet.yes')
					: e.moduleEnabled
						? t('api-docs.sheet.no')
						: t('api-docs.sheet.noModuleInactive')
			},
			{
				label: t('api-docs.sheet.rateLimit'),
				value: t(
					rl.isDefault ? 'api-docs.sheet.rateLimitDefault' : 'api-docs.sheet.rateLimitValue',
					{
						limit: formatNumber(rl.limit),
						window: formatNumber(rl.windowSec)
					}
				)
			}
		];
		if (e.multipart) {
			rows.push({
				label: t('api-docs.sheet.upload'),
				value: t('api-docs.sheet.uploadValue', {
					count: e.multipart.maxFiles,
					size: formatBytes(e.multipart.maxBytes)
				})
			});
		}
		rows.push({ label: t('api-docs.sheet.successStatus'), value: String(e.successStatus) });
		return rows;
	}

	const requestSections = (
		e: ApiCatalogEntry
	): { title: string; schema: JsonSchema | null; empty: string }[] => [
		{
			title: t('api-docs.sheet.pathParams'),
			schema: e.params,
			empty: t('api-docs.sheet.noPathParams')
		},
		{
			title: t('api-docs.sheet.queryParams'),
			schema: e.query,
			empty: t('api-docs.sheet.noQueryParams')
		},
		{ title: t('api-docs.sheet.body'), schema: e.body, empty: t('api-docs.sheet.noBody') }
	];

	async function copyPath(path: string) {
		try {
			await navigator.clipboard.writeText(path);
			toast.success(t('api-docs.sheet.pathCopied'));
		} catch {
			toast.error(t('api-docs.sheet.copyFailed'));
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		side="right"
		class="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
	>
		{#if entry}
			{#key entry.id}
				<Sheet.Header class="border-b pr-12">
					<div class="flex items-start gap-2">
						<span
							class={cn(
								'mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-xs font-semibold',
								METHOD_BADGE_CLASS[entry.method]
							)}
						>
							{entry.method}
						</span>
						<Sheet.Title class="min-w-0 flex-1 font-mono text-sm leading-6 break-all">
							{entry.path}
						</Sheet.Title>
						<Button
							variant="ghost"
							size="icon-sm"
							class="shrink-0"
							aria-label={t('api-docs.sheet.copyPath')}
							title={t('api-docs.sheet.copyPath')}
							onclick={() => copyPath(entry.path)}
						>
							<Copy />
						</Button>
					</div>
					<Sheet.Description>{entry.summary}</Sheet.Description>
				</Sheet.Header>

				<div class="p-4">
					<Tabs.Root value="overview">
						<Tabs.List variant="line">
							<Tabs.Trigger value="overview">{t('api-docs.sheet.tabOverview')}</Tabs.Trigger>
							<Tabs.Trigger value="request">{t('api-docs.sheet.tabRequest')}</Tabs.Trigger>
							<Tabs.Trigger value="response">{t('api-docs.sheet.tabResponse')}</Tabs.Trigger>
							<Tabs.Trigger value="errors">{t('api-docs.sheet.tabErrors')}</Tabs.Trigger>
							<Tabs.Trigger value="try">{t('api-docs.sheet.tabTry')}</Tabs.Trigger>
						</Tabs.List>

						<Tabs.Content value="overview" class="space-y-4 pt-2">
							<SummaryList rows={overviewRows(entry)} />
							{#if entry.description}
								<p class="text-muted-foreground text-sm whitespace-pre-line">
									{entry.description}
								</p>
							{/if}
						</Tabs.Content>

						<Tabs.Content value="request" class="space-y-5 pt-2">
							{#each requestSections(entry) as section (section.title)}
								<section class="space-y-2">
									<h3 class="text-sm font-semibold">{section.title}</h3>
									{#if section.schema}
										<SchemaTree schema={section.schema} emptyText={t('api-docs.sheet.none')} />
									{:else}
										<p class="text-muted-foreground text-sm">{t('api-docs.sheet.none')}</p>
									{/if}
								</section>
							{/each}
						</Tabs.Content>

						<Tabs.Content value="response" class="pt-2">
							<ResponsePanel {entry} />
						</Tabs.Content>

						<Tabs.Content value="errors" class="pt-2">
							<ErrorsTable errors={entry.errors} />
						</Tabs.Content>

						<Tabs.Content value="try" class="pt-2">
							<ApiConsole {entry} />
						</Tabs.Content>
					</Tabs.Root>
				</div>
			{/key}
		{:else}
			<Sheet.Header>
				<Sheet.Title>{t('api-docs.sheet.noEndpoint')}</Sheet.Title>
			</Sheet.Header>
		{/if}
	</Sheet.Content>
</Sheet.Root>
