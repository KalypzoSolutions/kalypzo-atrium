<script lang="ts">
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Button } from '$lib/components/ui/button';

	let {
		total,
		limit = 50,
		offset: offsetProp = 0,
		pageParam
	}: {
		total: number;
		limit?: number;
		offset?: number;
		/** Seitenbasierter Modus: URL-Parameter mit der Seitenzahl (ab 1) statt offset/limit */
		pageParam?: string;
	} = $props();

	const offset = $derived(
		pageParam
			? (Math.max(1, Number(page.url.searchParams.get(pageParam)) || 1) - 1) * limit
			: offsetProp
	);

	const from = $derived(total === 0 ? 0 : offset + 1);
	const to = $derived(Math.min(offset + limit, total));

	function go(newOffset: number) {
		const url = new URL(page.url);
		if (pageParam) {
			const n = Math.floor(Math.max(0, newOffset) / limit) + 1;
			if (n > 1) url.searchParams.set(pageParam, String(n));
			else url.searchParams.delete(pageParam);
		} else {
			url.searchParams.set('offset', String(Math.max(0, newOffset)));
			url.searchParams.set('limit', String(limit));
		}
		goto(url, { noScroll: true });
	}
</script>

<div class="flex items-center justify-between gap-2 pt-4 text-sm text-muted-foreground">
	<span aria-live="polite">{t('layout.pagination.range', { from, to, total })}</span>
	<div class="flex gap-2">
		<Button variant="outline" size="sm" disabled={offset <= 0} onclick={() => go(offset - limit)}>
			<ChevronLeft />
			{t('layout.pagination.prev')}
		</Button>
		<Button
			variant="outline"
			size="sm"
			disabled={offset + limit >= total}
			onclick={() => go(offset + limit)}
		>
			{t('layout.pagination.next')}
			<ChevronRight />
		</Button>
	</div>
</div>
