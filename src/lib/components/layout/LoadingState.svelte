<script lang="ts">
	import { t } from '$lib/i18n';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { cn } from '$lib/utils';

	/**
	 * Einheitlicher Ladezustand: Skeleton-Zeilen in Zielform + `role="status"` mit Screenreader-Text
	 * („Lädt …“ bzw. „Lädt <label> …“). Für Tabellen, Listen und Karten; layout-stabil über `rows`/`rowClass`.
	 */
	let {
		label,
		rows = 3,
		rowClass = 'h-8 w-full',
		variant = 'rows',
		class: className
	}: {
		/** Was geladen wird (z. B. „Konten“) – ergänzt den Screenreader-Text */
		label?: string;
		rows?: number;
		/** Klassen je Skeleton-Zeile (Höhe/Breite der Zielform) */
		rowClass?: string;
		/** `rows` = Skeleton-Zeilen, `text` = nur „Lädt …“ als kleine Zeile */
		variant?: 'rows' | 'text';
		class?: string;
	} = $props();

	const text = $derived(label ? t('layout.loadingLabel', { label }) : t('layout.busy.load'));
</script>

<div
	data-slot="loading-state"
	role="status"
	aria-live="polite"
	aria-busy="true"
	class={cn(variant === 'rows' ? 'space-y-2' : 'text-sm text-muted-foreground', className)}
>
	{#if variant === 'text'}
		{text}
	{:else}
		<span class="sr-only">{text}</span>
		{#each Array.from({ length: rows }, (_, i) => i) as i (i)}
			<Skeleton class={rowClass} />
		{/each}
	{/if}
</div>
