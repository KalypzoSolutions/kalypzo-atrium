<script lang="ts" generics="T extends string">
	import { t } from '$lib/i18n';
	// Unteransichten als Pillen, seitlich scrollbar statt Umbruch (Handy/Tablet).
	// Aktive Pille gefüllt; optional Zähler (z. B. „Ohne Zuordnung 3“).
	import { cn } from '$lib/utils.js';
	import CountBadge from './CountBadge.svelte';

	let {
		options,
		value,
		label,
		onchange,
		class: className
	}: {
		options: { value: T; label: string; count?: number | null }[];
		value: T;
		/** zugänglicher Name der Gruppe */
		label: string;
		onchange: (value: T) => void;
		class?: string;
	} = $props();

	function scrollIntoView(node: HTMLElement, active: boolean) {
		const run = (on: boolean) => {
			if (on) node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
		};
		run(active);
		return { update: run };
	}
</script>

<div
	role="group"
	aria-label={label}
	data-slot="scroll-pills"
	class={cn(
		'relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
		className
	)}
>
	{#each options as o (o.value)}
		{@const active = o.value === value}
		<button
			type="button"
			use:scrollIntoView={active}
			class={cn(
				'flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors',
				active ? 'border-foreground bg-foreground text-background' : 'bg-background hover:bg-muted'
			)}
			aria-pressed={active}
			onclick={() => {
				if (!active) onchange(o.value);
			}}
		>
			{o.label}
			{#if o.count}
				<CountBadge count={o.count} max={99} label={t('layout.entriesCount', { count: o.count })} />
			{/if}
		</button>
	{/each}
</div>
