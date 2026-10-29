<script lang="ts">
	// Kachel „Diese Woche“: Montag–Sonntag mit Gruppenstunden, Terminen, Aktionen, Material und
	// Fristen aus allen Modulen (`GET /dashboard/feed`). Jede Art hat ihre eigene Form (Fläche,
	// Rahmen, gestrichelt), Farbe nur für heute (Akzent) und verstrichene Fristen (rot).
	// Ab `md` sieben Spalten, darunter eine Liste ab heute.
	import { onMount } from 'svelte';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import { DashboardCard } from '$lib/components/layout';
	import { addDays } from '$lib/sdk/dates';
	import type {
		DashboardAgendaKind,
		DashboardFeed,
		DashboardFeedAgendaItem
	} from '$lib/sdk/types/dashboard';
	import type { DashboardWidgetProps } from '$lib/sdk/types/module-ui';
	import { loadDashboardFeed, shortDate } from './feed-data';

	let { onstatus }: DashboardWidgetProps = $props();

	let feed = $state<DashboardFeed | null>(null);
	let loading = $state(true);
	let error = $state('');

	async function load(fresh = false) {
		loading = true;
		error = '';
		onstatus?.('loading');
		try {
			feed = await loadDashboardFeed(fresh);
			onstatus?.('ready');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Die Woche konnte nicht geladen werden.';
			onstatus?.('error');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
	});

	const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
	const KIND_LABEL: Record<DashboardAgendaKind, string> = {
		meeting: 'Gruppenstunde',
		event: 'Termin',
		action: 'Aktion',
		material: 'Material',
		deadline: 'Frist'
	};
	const KIND_CLASS: Record<DashboardAgendaKind, string> = {
		meeting: 'border-transparent bg-muted',
		event: 'border-border bg-card',
		action: 'border-transparent bg-foreground/10',
		material: 'border-border border-l-foreground/50 border-l-2 bg-card',
		deadline: 'border-dashed border-foreground/30 bg-card'
	};

	const days = $derived.by(() => {
		if (!feed) return [];
		const f = feed;
		return WEEKDAYS.map((wd, i) => {
			const date = addDays(f.from, i);
			const items = f.agenda.filter((a) => a.date <= date && (a.endDate ?? a.date) >= date);
			return { wd, date, items, today: date === f.today, past: date < f.today, weekend: i >= 5 };
		});
	});
	const upcoming = $derived(days.filter((d) => !d.past && (d.items.length || d.today)));
	const kinds = $derived(
		(Object.keys(KIND_LABEL) as DashboardAgendaKind[]).filter((k) =>
			feed?.agenda.some((a) => a.kind === k)
		)
	);

	function timeLabel(a: DashboardFeedAgendaItem, date: string): string {
		const multi = a.endDate && a.endDate !== a.date;
		if (multi && date !== a.date && date !== a.endDate) return 'ganztägig';
		if (multi && date === a.date) return a.startTime ? `ab ${a.startTime}` : 'Beginn';
		if (multi && date === a.endDate) return a.endTime ? `bis ${a.endTime}` : 'Ende';
		if (a.startTime && a.endTime) return `${a.startTime}–${a.endTime}`;
		if (a.startTime) return a.startTime;
		return a.kind === 'deadline' ? 'Frist' : 'ganztägig';
	}
</script>

{#snippet entry(a: DashboardFeedAgendaItem, date: string, past: boolean)}
	<a
		href={a.href}
		class={[
			'block min-w-0 rounded border px-2 py-1.5 text-xs leading-snug transition-colors hover:border-foreground/40',
			KIND_CLASS[a.kind],
			a.late && 'border-destructive',
			past && !a.late && 'opacity-60'
		]}
	>
		<span class={['block tabular-nums', a.late ? 'text-destructive' : 'text-muted-foreground']}>
			{timeLabel(a, date)}{a.late ? ' · überfällig' : ''}
		</span>
		<span class="block font-medium break-words hyphens-auto" lang="de">{a.title}</span>
		{#if a.detail}<span class="block text-muted-foreground">{a.detail}</span>{/if}
		<span class="sr-only">({KIND_LABEL[a.kind]})</span>
	</a>
{/snippet}

<DashboardCard title="Diese Woche" icon={CalendarDays} {loading} {error} onretry={() => load(true)}>
	{#snippet actions()}
		{#if feed}
			<span class="text-xs text-muted-foreground tabular-nums">
				{shortDate(feed.from)}–{shortDate(feed.to)}
			</span>
		{/if}
	{/snippet}
	{#if feed}
		{#if kinds.length}
			<ul
				class="flex flex-wrap gap-x-3 gap-y-1 pb-2 text-xs text-muted-foreground"
				aria-hidden="true"
			>
				{#each kinds as k (k)}
					<li class="flex items-center gap-1.5">
						<span class={['inline-block h-2.5 w-3.5 rounded-sm border', KIND_CLASS[k]]}></span>
						{KIND_LABEL[k]}
					</li>
				{/each}
			</ul>
		{/if}
		<!-- ab md: sieben Spalten -->
		<ol class="-mx-4 hidden grid-cols-7 border-t md:grid" data-testid="week-grid">
			{#each days as d (d.date)}
				<li
					class={[
						'flex min-h-36 min-w-0 flex-col gap-1.5 border-t-2 border-l px-1.5 pt-2 pb-3 first:border-l-0',
						d.today ? 'border-t-primary' : 'border-t-transparent',
						d.weekend && 'bg-muted/40'
					]}
					aria-current={d.today ? 'date' : undefined}
				>
					<p class="flex items-baseline gap-1.5 px-0.5 text-xs text-muted-foreground">
						{d.wd}
						<span
							class={[
								'text-sm font-semibold tabular-nums',
								d.today ? 'text-link' : d.past ? 'text-muted-foreground' : 'text-foreground'
							]}>{Number(d.date.slice(8))}</span
						>
						{#if d.today}<span class="text-link">heute</span>{/if}
					</p>
					{#each d.items as a (a.moduleId + a.id)}
						{@render entry(a, d.date, d.past)}
					{/each}
				</li>
			{/each}
		</ol>
		<!-- schmal: Liste ab heute -->
		<ol class="divide-y md:hidden" data-testid="week-list">
			{#each upcoming as d (d.date)}
				<li class="grid grid-cols-[3.5rem_1fr] gap-3 py-2.5">
					<p class={['text-xs', d.today ? 'text-link' : 'text-muted-foreground']}>
						{d.wd}{d.today ? ' · heute' : ''}
						<span
							class={[
								'block text-sm font-semibold tabular-nums',
								d.today ? 'text-link' : 'text-foreground'
							]}>{shortDate(d.date)}</span
						>
					</p>
					<div class="grid min-w-0 gap-1.5">
						{#each d.items as a (a.moduleId + a.id)}
							{@render entry(a, d.date, false)}
						{:else}
							<p class="text-xs text-muted-foreground">Nichts geplant.</p>
						{/each}
					</div>
				</li>
			{/each}
		</ol>
		{#if !feed.agenda.length}
			<p class="pt-2 text-sm text-muted-foreground">Diese Woche steht nichts an.</p>
		{/if}
	{/if}
</DashboardCard>
