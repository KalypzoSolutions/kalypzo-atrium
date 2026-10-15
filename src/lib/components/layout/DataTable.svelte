<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as Table from '$lib/components/ui/table';
	import EmptyState from './EmptyState.svelte';

	/**
	 * Einheitliche Tabellen-Karte: optionale Toolbar (Suche/Filter), Ladezustand, Fehler,
	 * Leer-Zustand, scrollbare Tabelle und optionale Fußzeile (z. B. Pagination).
	 *
	 * `head` rendert die Kopfzeile (`<Table.Row>` mit `<Table.Head>`), `children` die Zeilen.
	 */
	let {
		caption,
		title,
		description,
		loading = false,
		error = '',
		empty = false,
		emptyTitle = 'Keine Einträge',
		emptyDescription,
		skeletonRows = 5,
		toolbar,
		head,
		children,
		footer,
		emptyAction
	}: {
		/** Zugaengliche Beschreibung der Tabelle */
		caption: string;
		/** Optionaler sichtbarer Kartentitel (+ Beschreibung) */
		title?: string;
		description?: string;
		loading?: boolean;
		error?: string;
		/** Keine Datensaetze vorhanden (nach Laden/Filtern) */
		empty?: boolean;
		emptyTitle?: string;
		emptyDescription?: string;
		skeletonRows?: number;
		toolbar?: Snippet;
		head: Snippet;
		children: Snippet;
		footer?: Snippet;
		emptyAction?: Snippet;
	} = $props();
</script>

<Card.Root>
	{#if title}
		<Card.Header>
			<Card.Title>{title}</Card.Title>
			{#if description}<Card.Description>{description}</Card.Description>{/if}
		</Card.Header>
	{/if}
	<Card.Content class={title ? 'space-y-4' : 'space-y-4 pt-6'}>
		{#if toolbar}
			<div class="flex flex-wrap items-center gap-2">{@render toolbar()}</div>
		{/if}

		{#if error}
			<p class="text-sm text-destructive" role="alert">{error}</p>
		{:else if loading && empty}
			<div class="space-y-2" aria-busy="true" aria-label="Lade {caption}">
				{#each Array.from({ length: skeletonRows }, (_, i) => i) as i (i)}
					<Skeleton class="h-10 w-full" />
				{/each}
			</div>
		{:else if empty}
			<EmptyState title={emptyTitle} description={emptyDescription}>
				{#if emptyAction}{@render emptyAction()}{/if}
			</EmptyState>
		{:else}
			<div class="overflow-x-auto transition-opacity" class:opacity-60={loading}>
				<Table.Root aria-label={caption}>
					<Table.Header>{@render head()}</Table.Header>
					<Table.Body>{@render children()}</Table.Body>
				</Table.Root>
			</div>
		{/if}

		{#if footer}{@render footer()}{/if}
	</Card.Content>
</Card.Root>
