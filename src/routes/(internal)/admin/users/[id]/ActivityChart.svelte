<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatDate, formatNumber } from '$lib/i18n/intl';

	/**
	 * Aktivität je Tag als Säulen (eine Serie, Akzentfarbe, keine Legende – der Kartentitel benennt sie).
	 * Hover/Fokus zeigt Tag und Anzahl; für Screenreader steht eine Tabelle der aktiven Tage bereit.
	 */
	let { days }: { days: { day: string; count: number }[] } = $props();

	const W = 720;
	const H = 120;
	const GAP = 2;
	const max = $derived(Math.max(1, ...days.map((d) => d.count)));
	const barW = $derived(days.length ? W / days.length - GAP : 0);
	const total = $derived(days.reduce((a, d) => a + d.count, 0));
	const active = $derived(days.filter((d) => d.count > 0));
	let hover = $state<number | null>(null);

	const label = (d: { day: string; count: number }) =>
		t('admin-users.detail.chart.bar', {
			date: formatDate(new Date(`${d.day}T12:00:00Z`)),
			count: d.count
		});

	function bar(i: number, count: number) {
		const h = count > 0 ? Math.max(3, (count / max) * (H - 4)) : 0;
		return { x: i * (barW + GAP), y: H - h, h };
	}
</script>

<div class="space-y-2">
	<p class="text-sm text-muted-foreground">
		{total > 0
			? t('admin-users.detail.chart.summary', { count: total, days: active.length })
			: t('admin-users.detail.chart.empty')}
		{#if hover !== null && days[hover]}
			<span class="ml-2 font-medium text-foreground tabular-nums">{label(days[hover]!)}</span>
		{/if}
	</p>
	{#if total > 0}
		<svg
			viewBox="0 0 {W} {H + 1}"
			class="h-32 w-full"
			preserveAspectRatio="none"
			role="img"
			aria-label={t('admin-users.detail.chart.aria', { count: total })}
			onmouseleave={() => (hover = null)}
		>
			<line x1="0" y1={H + 0.5} x2={W} y2={H + 0.5} class="stroke-border" stroke-width="1" />
			{#each days as d, i (d.day)}
				{@const b = bar(i, d.count)}
				<!-- Trefferfläche über die ganze Höhe (größer als die Säule) -->
				<rect
					x={b.x}
					y="0"
					width={barW + GAP}
					height={H}
					fill="transparent"
					onmouseenter={() => (hover = i)}
					role="presentation"
				>
					<title>{label(d)}</title>
				</rect>
				{#if d.count > 0}
					<rect
						x={b.x}
						y={b.y}
						width={Math.max(1, barW)}
						height={b.h}
						rx="1.5"
						class="pointer-events-none fill-primary"
						opacity={hover === null || hover === i ? 1 : 0.45}
					/>
				{/if}
			{/each}
		</svg>
		<div class="flex justify-between text-xs text-muted-foreground tabular-nums">
			<span>{days[0] ? formatDate(new Date(`${days[0].day}T12:00:00Z`)) : ''}</span>
			<span>{t('admin-users.detail.chart.max', { count: formatNumber(max) })}</span>
			<span>{t('admin-users.detail.chart.today')}</span>
		</div>
	{/if}
	<table class="sr-only">
		<caption>{t('admin-users.detail.activityTitle')}</caption>
		<thead
			><tr
				><th>{t('admin-users.detail.chart.date')}</th><th>{t('admin-users.detail.chart.count')}</th
				></tr
			></thead
		>
		<tbody>
			{#each active as d (d.day)}
				<tr><td>{formatDate(new Date(`${d.day}T12:00:00Z`))}</td><td>{d.count}</td></tr>
			{/each}
		</tbody>
	</table>
</div>
