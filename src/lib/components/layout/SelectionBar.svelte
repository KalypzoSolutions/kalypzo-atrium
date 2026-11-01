<script lang="ts">
	import { t } from '$lib/i18n';
	// Auswahlmodus einer Touch-Liste: oben „N ausgewählt“ mit Summe und „Alle“, unten feste
	// Leiste mit den Sammelaktionen (verdeckt die Bereichsleiste). Beenden über ✕.
	import type { Snippet } from 'svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';

	let {
		count,
		summary,
		allSelected,
		onall,
		onclose,
		label,
		actions,
		fixed = true
	}: {
		count: number;
		/** z. B. Summe der Auswahl */
		summary?: string;
		allSelected: boolean;
		/** alle wählen bzw. alle abwählen */
		onall: () => void;
		/** Auswahlmodus beenden */
		onclose: () => void;
		/** zugänglicher Name der Aktionsleiste */
		label: string;
		actions: Snippet;
		/** Aktionen unten fixiert (Handy); sonst im Fluss unter dem Kopf (Tablet) */
		fixed?: boolean;
	} = $props();
</script>

<div
	class="sticky top-0 z-30 -mx-1 flex items-center gap-1 rounded-lg border bg-background/95 py-1 pr-1.5 pl-1 shadow-sm backdrop-blur"
>
	<button
		type="button"
		class="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted"
		aria-label={t('layout.selection.close')}
		onclick={onclose}
	>
		<XIcon class="size-5" />
	</button>
	<div class="flex min-w-0 flex-1 flex-col" aria-live="polite">
		<strong class="truncate">{t('layout.selection.count', { count })}</strong>
		{#if summary}<span class="truncate text-xs text-muted-foreground">{summary}</span>{/if}
	</div>
	<Button variant="outline" size="sm" onclick={onall}
		>{allSelected ? t('layout.selection.none') : t('layout.selection.all')}</Button
	>
	{#if !fixed}
		<div role="toolbar" aria-label={label} class="ml-1 flex flex-wrap gap-2">
			{@render actions()}
		</div>
	{/if}
</div>
{#if fixed}
	<div
		role="toolbar"
		aria-label={label}
		class={cn(
			'safe-bottom fixed inset-x-0 bottom-0 z-50 grid auto-cols-fr grid-flow-col gap-2 border-t bg-background px-2 pt-1.5 [&>*]:min-h-12'
		)}
	>
		{@render actions()}
	</div>
{/if}
