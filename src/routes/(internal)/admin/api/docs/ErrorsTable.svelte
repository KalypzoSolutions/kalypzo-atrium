<script lang="ts">
	import type { ApiErrorInfo } from '$lib/api-docs/types';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import { cn } from '$lib/utils.js';
	import { t } from '$lib/i18n';

	let { errors }: { errors: ApiErrorInfo[] } = $props();

	const FORMAT = '{ "error": { "code": "…", "message": "…", "details": …, "requestId": "…" } }';

	function statusClass(status: number): string {
		if (status >= 500) return 'bg-destructive/10 text-destructive dark:bg-destructive/20';
		return 'bg-warning-muted text-warning';
	}
</script>

<div class="space-y-3">
	<div class="space-y-2 text-sm text-muted-foreground">
		<p>{t('api-docs.errors.formatIntro')}</p>
		<pre
			class="overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-xs text-foreground">{FORMAT}</pre>
		<p>
			{t('api-docs.errors.detailsBefore')}
			<code class="font-mono text-xs text-foreground">details</code>
			{t('api-docs.errors.detailsMiddle')}<code class="font-mono text-xs text-foreground">path</code
			>,
			<code class="font-mono text-xs text-foreground">message</code>{t(
				'api-docs.errors.detailsAfter'
			)}
		</p>
	</div>

	{#if errors.length === 0}
		<p class="text-sm text-muted-foreground">{t('api-docs.errors.none')}</p>
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head class="w-20">{t('api-docs.errors.status')}</Table.Head>
					<Table.Head>{t('api-docs.errors.code')}</Table.Head>
					<Table.Head>{t('api-docs.errors.when')}</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each errors as err, i (`${err.status}-${err.code}-${i}`)}
					<Table.Row>
						<Table.Cell class="align-top">
							<Badge
								variant="outline"
								class={cn('border-transparent tabular-nums', statusClass(err.status))}
							>
								{err.status}
							</Badge>
						</Table.Cell>
						<Table.Cell class="align-top font-mono text-xs">{err.code}</Table.Cell>
						<Table.Cell class="min-w-48 align-top whitespace-normal text-muted-foreground">
							{err.when}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
