<script lang="ts" module>
	export interface SummaryRow {
		label: string;
		value: string;
		/** Erläuterung als Tooltip (per Fokus/Hover erreichbar) */
		hint?: string;
		emphasis?: 'normal' | 'strong' | 'muted';
		/** Abzug: dezente Farbe und führendes „−“ */
		negative?: boolean;
		details?: { label: string; value: string }[];
	}
</script>

<script lang="ts">
	import { t } from '$lib/i18n';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Info from '@lucide/svelte/icons/info';
	import { cn } from '$lib/utils';

	let { rows, class: className }: { rows: SummaryRow[]; class?: string } = $props();

	const uid = $props.id();
	let open = $state<Record<number, boolean>>({});
</script>

<dl class={cn('divide-border/60 divide-y text-sm', className)}>
	{#each rows as row, i (i)}
		{@const strong = row.emphasis === 'strong'}
		{@const hasDetails = !!row.details?.length}
		<div class="py-1.5">
			<div class="flex items-baseline justify-between gap-4">
				<dt
					class={cn(
						'flex min-w-0 items-center gap-1',
						strong && 'text-base font-semibold',
						row.emphasis === 'muted' && 'text-muted-foreground'
					)}
				>
					{#if hasDetails}
						<button
							type="button"
							class="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-3"
							aria-expanded={!!open[i]}
							aria-controls="{uid}-d{i}"
							aria-label={open[i]
								? t('layout.summary.hideDetails', { label: row.label })
								: t('layout.summary.showDetails', { label: row.label })}
							onclick={() => (open[i] = !open[i])}
						>
							<ChevronRight class={cn('size-4 transition-transform', open[i] && 'rotate-90')} />
						</button>
					{/if}
					<span class="truncate">{row.label}</span>
					{#if row.hint}
						<span class="group relative inline-flex">
							<button
								type="button"
								class="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-5 items-center justify-center rounded-full outline-none focus-visible:ring-3"
								aria-label={t('layout.summary.hint', { label: row.label })}
								aria-describedby="{uid}-h{i}"
							>
								<Info class="size-3.5" />
							</button>
							<span
								id="{uid}-h{i}"
								role="tooltip"
								class="bg-foreground text-background pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 hidden w-max max-w-64 -translate-x-1/2 rounded-md px-2.5 py-1.5 text-xs font-normal group-focus-within:block group-hover:block"
							>
								{row.hint}
							</span>
						</span>
					{/if}
				</dt>
				<dd
					class={cn(
						'shrink-0 text-right tabular-nums',
						strong && 'text-base font-semibold',
						row.emphasis === 'muted' && 'text-muted-foreground',
						row.negative && 'text-warning'
					)}
				>
					{#if row.negative}<span aria-hidden="true">−</span><span class="sr-only"
							>{t('layout.summary.minus')}
						</span>{/if}{row.value}
				</dd>
			</div>
			{#if hasDetails && open[i]}
				<dl id="{uid}-d{i}" class="text-muted-foreground mt-1 space-y-0.5 pl-5 text-xs">
					{#each row.details ?? [] as d, j (j)}
						<div class="flex items-baseline justify-between gap-4">
							<dt class="min-w-0 truncate">{d.label}</dt>
							<dd class="shrink-0 text-right tabular-nums">{d.value}</dd>
						</div>
					{/each}
				</dl>
			{/if}
		</div>
	{/each}
</dl>
