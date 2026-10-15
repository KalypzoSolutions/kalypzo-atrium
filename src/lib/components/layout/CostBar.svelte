<script lang="ts" module>
	export interface CostSegment {
		label: string;
		value: number;
		color?: string;
	}

	/** Kategoriale Palette (8 Farben, in Hell und Dunkel unterscheidbar; Wert zusaetzlich als Prozent) */
	const PALETTE = [
		'#2563eb',
		'#e8710a',
		'#12a594',
		'#c026d3',
		'#ca8a04',
		'#dc2626',
		'#4d7c0f',
		'#7c3aed'
	];
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		segments,
		format = (n: number) => n.toLocaleString('de-DE'),
		class: className
	}: {
		segments: CostSegment[];
		format?: (n: number) => string;
		class?: string;
	} = $props();

	const items = $derived.by(() => {
		const list = segments.map((s, i) => ({
			...s,
			value: Math.max(0, s.value),
			color: s.color ?? PALETTE[i % PALETTE.length]
		}));
		const total = list.reduce((a, s) => a + s.value, 0);
		return {
			total,
			list: list.map((s) => ({ ...s, pct: total > 0 ? (s.value / total) * 100 : 0 }))
		};
	});

	const fmtPct = (p: number) =>
		p > 0 && p < 1 ? '<1 %' : `${Math.round(p).toLocaleString('de-DE')} %`;

	const summary = $derived(
		`Kostenverteilung, gesamt ${format(items.total)}: ` +
			items.list.map((s) => `${s.label} ${format(s.value)} (${fmtPct(s.pct)})`).join(', ')
	);
</script>

<div class={cn('space-y-3', className)}>
	<div
		role="img"
		aria-label={summary}
		class="bg-muted flex h-3 w-full gap-px overflow-hidden rounded-full"
	>
		{#each items.list as s, i (i)}
			{#if s.value > 0}
				<div
					class="h-full min-w-1"
					style="flex: {s.value} 1 0%; background-color: {s.color}"
					title="{s.label}: {format(s.value)}"
				></div>
			{/if}
		{/each}
	</div>
	<ul class="space-y-1 text-sm">
		{#each items.list as s, i (i)}
			<li class="flex items-center gap-2">
				<span
					class="size-2.5 shrink-0 rounded-full"
					style="background-color: {s.color}"
					aria-hidden="true"
				></span>
				<span class="min-w-0 flex-1 truncate">{s.label}</span>
				<span class="tabular-nums">{format(s.value)}</span>
				<span class="text-muted-foreground w-12 text-right tabular-nums">{fmtPct(s.pct)}</span>
			</li>
		{/each}
	</ul>
</div>
