<script lang="ts">
	// Zeile einer Touch-Liste (Handy/Tablet statt Tabelle): Titel, Unterzeile, Betrag, Status.
	// Antippen → `onclick` (Aktionsblatt bzw. Details), lange drücken → `onlongpress` (Auswahl).
	// Im Auswahlmodus (`selecting`) zeigt die Zeile einen runden Haken.
	import type { Snippet } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import { cn } from '$lib/utils.js';
	import { longpress } from './long-press';

	let {
		title,
		subtitle,
		amount,
		amountClass,
		trailing,
		leading,
		below,
		selecting = false,
		selected = false,
		active = false,
		disabled = false,
		onclick,
		onlongpress,
		label,
		wrap = false,
		class: className
	}: {
		title: string;
		subtitle?: string;
		/** rechts oben, fett mit Ziffern gleicher Breite */
		amount?: string;
		amountClass?: string;
		/** rechts unter dem Betrag (z. B. Status-Badge) */
		trailing?: Snippet;
		/** links vor dem Text (z. B. Symbol) – im Auswahlmodus ersetzt durch den Haken */
		leading?: Snippet;
		/** unter der Zeile, innerhalb des Rahmens (z. B. Vorschlag) */
		below?: Snippet;
		selecting?: boolean;
		selected?: boolean;
		/** gerade in den Details geöffnet (Tablet) */
		active?: boolean;
		disabled?: boolean;
		onclick?: () => void;
		onlongpress?: () => void;
		/** zugänglicher Name, falls Titel allein nicht reicht */
		label?: string;
		/** Titel und Unterzeile umbrechen statt abschneiden (z. B. Hinweise) */
		wrap?: boolean;
		class?: string;
	} = $props();
</script>

<div
	data-slot="list-row"
	class={cn(
		'border-b last:border-b-0',
		selected && 'bg-link/10',
		active && !selected && 'bg-muted',
		className
	)}
>
	<button
		type="button"
		class="flex min-h-17 w-full items-center gap-3 px-3.5 py-2.5 text-left select-none [-webkit-touch-callout:none] hover:bg-muted/60 active:bg-muted disabled:opacity-60"
		aria-label={label}
		aria-pressed={selecting ? selected : undefined}
		aria-current={active ? 'true' : undefined}
		{disabled}
		{onclick}
		use:longpress={{ onlongpress: () => onlongpress?.(), disabled: !onlongpress || disabled }}
	>
		{#if selecting}
			<span
				class={cn(
					'flex size-6 shrink-0 items-center justify-center rounded-full border-2',
					selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
				)}
				aria-hidden="true"
			>
				{#if selected}<Check class="size-4" strokeWidth={3} />{/if}
			</span>
		{:else}
			{@render leading?.()}
		{/if}
		<span class="flex min-w-0 flex-1 flex-col gap-0.5">
			<span class={cn('font-semibold', wrap ? 'leading-snug' : 'truncate')}>{title}</span>
			{#if subtitle}
				<span class={cn('text-sm text-muted-foreground', wrap ? 'line-clamp-2' : 'truncate')}
					>{subtitle}</span
				>
			{/if}
		</span>
		{#if amount || trailing}
			<span class="flex shrink-0 flex-col items-end gap-1">
				{#if amount}
					<span class={cn('font-bold tabular-nums', amountClass)}>{amount}</span>
				{/if}
				{@render trailing?.()}
			</span>
		{/if}
	</button>
	{@render below?.()}
</div>
