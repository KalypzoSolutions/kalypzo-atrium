<script lang="ts">
	import { t } from '$lib/i18n';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Plus from '@lucide/svelte/icons/plus';
	import Repeat from '@lucide/svelte/icons/repeat';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import {
		MAX_LANES,
		buildAgenda,
		buildMonthGrid,
		calendarItemKey,
		contrastTextColor,
		describeItem,
		formatDayLabel,
		formatItemTime,
		formatLongDate,
		formatMonthLabel,
		formatShortDate,
		isValidMonth,
		itemRange,
		itemsOnDay,
		layoutWeek,
		localToday,
		monthOf,
		shiftMonth,
		weekdayLabels,
		type CalendarItem,
		type WeekSegment
	} from './month-calendar';

	interface Props {
		items: CalendarItem[];
		/** Angezeigter Monat `YYYY-MM` (bindbar). */
		month?: string;
		/** Heutiges Datum `YYYY-MM-DD` (Standard: lokales Datum). */
		today?: string;
		onselect?: (item: CalendarItem) => void;
		/** Wenn gesetzt, erscheint je Tag ein „Termin anlegen“-Knopf. */
		onday?: (date: string) => void;
		loading?: boolean;
		class?: string;
	}

	let {
		items,
		month = $bindable(),
		today = localToday(),
		onselect,
		onday,
		loading = false,
		class: className = ''
	}: Props = $props();

	const current = $derived(isValidMonth(month) ? month : monthOf(today));
	const weeks = $derived(buildMonthGrid(current).map((days) => layoutWeek(days, items)));
	const agenda = $derived(buildAgenda(current, items));
	const label = $derived(formatMonthLabel(current));
	const weekdays = weekdayLabels();

	let openDay = $state<string | null>(null);

	// Zeilenhöhen der Balken (rem): Kopf 1.75, Spur 1.375
	const HEAD = 1.75;
	const LANE = 1.375;

	function go(delta: number) {
		month = shiftMonth(current, delta);
	}

	function goToday() {
		month = monthOf(today);
	}

	function select(item: CalendarItem) {
		openDay = null;
		onselect?.(item);
	}

	function barStyle(seg: WeekSegment): string {
		const parts = [
			`top: ${HEAD + seg.lane * LANE}rem`,
			`width: calc(${seg.span} * 100% + ${seg.span - 1}px - 6px)`
		];
		const fg = contrastTextColor(seg.item.color);
		if (fg) parts.push(`background-color: ${seg.item.color}`, `color: ${fg}`);
		return parts.join('; ');
	}

	function dotStyle(item: CalendarItem): string {
		return contrastTextColor(item.color) ? `background-color: ${item.color}` : '';
	}

	function rangeText(item: CalendarItem): string {
		const r = itemRange(item);
		if (!r || r.start === r.end) return '';
		return `${formatShortDate(r.start)}–${formatShortDate(r.end)}`;
	}
</script>

<div class="space-y-3 {className}">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-section" aria-live="polite">{label}</h2>
		<div class="flex items-center gap-1">
			{#if loading}
				<span class="text-muted-foreground mr-2 text-xs" role="status">{t('calendar.loading')}</span
				>
			{/if}
			<Button variant="outline" size="sm" onclick={goToday} aria-label={t('calendar.today')}
				>{t('calendar.today')}</Button
			>
			<Button
				variant="outline"
				size="icon-sm"
				onclick={() => go(-1)}
				aria-label={t('calendar.prevMonth')}
			>
				<ChevronLeft />
			</Button>
			<Button
				variant="outline"
				size="icon-sm"
				onclick={() => go(1)}
				aria-label={t('calendar.nextMonth')}
			>
				<ChevronRight />
			</Button>
		</div>
	</div>

	<!-- Raster ab 640 px -->
	<div
		class="bg-card hidden overflow-hidden rounded-lg border transition-opacity sm:block"
		class:opacity-60={loading}
		role="table"
		aria-label={t('calendar.gridLabel', { month: label })}
		aria-busy={loading}
	>
		<div class="bg-muted/40 grid grid-cols-7 border-b" role="row">
			{#each weekdays as wd (wd)}
				<div class="text-muted-foreground px-2 py-1.5 text-xs font-medium" role="columnheader">
					{wd}
				</div>
			{/each}
		</div>
		{#each weeks as week (week.days[0])}
			<div class="grid grid-cols-7 border-b last:border-b-0" role="row">
				{#each week.days as date, col (date)}
					{@const inMonth = monthOf(date) === current}
					{@const isToday = date === today}
					{@const hidden = week.hidden[col] ?? 0}
					<div
						class="group relative min-h-[7.5rem] border-r last:border-r-0 {inMonth
							? ''
							: 'bg-muted/30'} {isToday ? 'bg-primary/5' : ''}"
						role="cell"
						aria-label={formatLongDate(date)}
					>
						<div class="flex h-7 items-center justify-between px-1.5">
							<span
								class="inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums {isToday
									? 'bg-primary text-primary-foreground font-semibold'
									: inMonth
										? 'text-foreground'
										: 'text-muted-foreground/60'}"
								aria-hidden="true"
							>
								{Number(date.slice(8, 10))}
							</span>
							{#if isToday}<span class="sr-only">{t('calendar.today')}</span>{/if}
							{#if onday}
								<button
									type="button"
									class="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded-md opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-3"
									aria-label={t('calendar.createOn', { date: formatLongDate(date) })}
									onclick={() => onday?.(date)}
								>
									<Plus class="size-3.5" />
								</button>
							{/if}
						</div>
						{#each week.segments.filter((s) => s.startCol === col) as seg (calendarItemKey(seg.item))}
							{@const time = seg.continuesBefore ? '' : formatItemTime(seg.item)}
							<button
								type="button"
								class="focus-visible:ring-ring absolute left-[3px] z-10 flex h-5 items-center gap-1 overflow-hidden px-1.5 text-left text-xs leading-none outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-offset-1 {seg
									.item.color && contrastTextColor(seg.item.color)
									? ''
									: 'bg-primary text-primary-foreground'} {seg.continuesBefore
									? 'rounded-l-none'
									: 'rounded-l-md'} {seg.continuesAfter ? 'rounded-r-none' : 'rounded-r-md'}"
								style={barStyle(seg)}
								aria-label={describeItem(seg.item)}
								title={describeItem(seg.item)}
								onclick={() => select(seg.item)}
							>
								{#if time}<span class="shrink-0 tabular-nums opacity-80">{time}</span>{/if}
								{#if seg.item.recurring}<Repeat
										class="size-3 shrink-0 opacity-80"
										aria-hidden="true"
									/>{/if}
								<span class="truncate font-medium">{seg.item.title}</span>
							</button>
						{/each}
						{#if hidden > 0}
							<Popover.Root
								open={openDay === date}
								onOpenChange={(o) => (openDay = o ? date : null)}
							>
								<Popover.Trigger
									class="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring absolute left-[3px] z-10 h-5 rounded-md px-1.5 text-left text-xs outline-none focus-visible:ring-3"
									style="top: {HEAD + MAX_LANES * LANE}rem"
									aria-label={t('calendar.moreOn', { count: hidden, date: formatLongDate(date) })}
								>
									{t('calendar.more', { count: hidden })}
								</Popover.Trigger>
								<Popover.Content class="w-64">
									<p class="mb-1 px-1 text-xs font-medium">{formatDayLabel(date)}</p>
									<ul class="space-y-0.5">
										{#each itemsOnDay(items, date) as item (calendarItemKey(item))}
											<li>
												<button
													type="button"
													class="hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none focus-visible:ring-3"
													aria-label={describeItem(item)}
													onclick={() => select(item)}
												>
													<span
														class="bg-primary size-2.5 shrink-0 rounded-full"
														style={dotStyle(item)}
														aria-hidden="true"
													></span>
													{#if formatItemTime(item)}
														<span class="text-muted-foreground shrink-0 text-xs tabular-nums"
															>{formatItemTime(item)}</span
														>
													{/if}
													{#if item.recurring}<Repeat
															class="text-muted-foreground size-3 shrink-0"
															aria-hidden="true"
														/>{/if}
													<span class="truncate">{item.title}</span>
												</button>
											</li>
										{/each}
									</ul>
								</Popover.Content>
							</Popover.Root>
						{/if}
					</div>
				{/each}
			</div>
		{/each}
	</div>

	<!-- Agenda unter 640 px -->
	<div class="sm:hidden" class:opacity-60={loading} aria-busy={loading}>
		{#if agenda.length === 0}
			<div class="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
				{t('calendar.emptyMonth')}
				{#if onday}
					<div class="mt-3">
						<Button variant="outline" size="sm" onclick={() => onday?.(today)}>
							<Plus />
							{t('calendar.create')}
						</Button>
					</div>
				{/if}
			</div>
		{:else}
			<ul class="space-y-3" aria-label={t('calendar.agendaLabel', { month: label })}>
				{#each agenda as day (day.date)}
					{@const isToday = day.date === today}
					<li class="bg-card rounded-lg border">
						<div class="flex items-center justify-between gap-2 border-b px-3 py-1.5">
							<h3
								class="text-sm font-semibold"
								aria-label={isToday
									? t('calendar.dayToday', { date: formatLongDate(day.date) })
									: formatLongDate(day.date)}
							>
								{formatDayLabel(day.date)}
								{#if isToday}
									<span
										class="bg-primary text-primary-foreground ml-1 rounded-full px-1.5 py-0.5 text-[0.7rem] font-medium"
										>{t('calendar.today')}</span
									>
								{/if}
							</h3>
							{#if onday}
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={t('calendar.createOn', { date: formatLongDate(day.date) })}
									onclick={() => onday?.(day.date)}
								>
									<Plus />
								</Button>
							{/if}
						</div>
						<ul class="divide-y">
							{#each day.items as item (calendarItemKey(item))}
								<li>
									<button
										type="button"
										class="hover:bg-muted/50 focus-visible:ring-ring flex w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-inset"
										aria-label={describeItem(item)}
										onclick={() => select(item)}
									>
										<span
											class="bg-primary h-8 w-1 shrink-0 rounded-full"
											style={dotStyle(item)}
											aria-hidden="true"
										></span>
										<span class="min-w-0 flex-1">
											<span class="flex min-w-0 items-center gap-1.5 font-medium">
												{#if item.recurring}<Repeat
														class="text-muted-foreground size-3.5 shrink-0"
														aria-hidden="true"
													/>{/if}
												<span class="truncate">{item.title}</span>
											</span>
											{#if formatItemTime(item) || rangeText(item)}
												<span class="text-muted-foreground block text-xs tabular-nums">
													{[rangeText(item), formatItemTime(item)].filter(Boolean).join(' · ')}
												</span>
											{/if}
										</span>
									</button>
								</li>
							{/each}
						</ul>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
