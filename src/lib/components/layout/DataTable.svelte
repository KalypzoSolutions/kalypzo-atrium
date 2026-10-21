<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import EmptyState from './EmptyState.svelte';
	import ErrorState from './ErrorState.svelte';
	import LoadingState from './LoadingState.svelte';

	/**
	 * Einheitliche Tabellen-Karte: optionale Toolbar (Suche/Filter), Ladezustand, Fehler,
	 * Leer-Zustand, scrollbare Tabelle und optionale Fußzeile (z. B. Pagination).
	 *
	 * `head` rendert die Kopfzeile (`<Table.Row>` mit `<Table.Head>`), `children` die Zeilen.
	 */
	let {
		caption,
		title,
		titleLevel = 2,
		description,
		loading = false,
		error = '',
		onretry,
		empty = false,
		emptyTitle = 'Keine Einträge',
		emptyDescription,
		skeletonRows = 5,
		toolbar,
		head,
		children,
		footer,
		emptyAction,
		mobile = 'scroll'
	}: {
		/** Zugängliche Beschreibung der Tabelle */
		caption: string;
		/** Optionaler sichtbarer Kartentitel (+ Beschreibung) */
		title?: string;
		/** Überschriftsebene des Titels (`3` unter einer Abschnittsüberschrift) */
		titleLevel?: 2 | 3 | 4;
		description?: string;
		loading?: boolean;
		error?: string;
		/** „Erneut versuchen“ im Fehlerzustand */
		onretry?: () => void | Promise<void>;
		/** Keine Datensätze vorhanden (nach Laden/Filtern) */
		empty?: boolean;
		emptyTitle?: string;
		emptyDescription?: string;
		skeletonRows?: number;
		toolbar?: Snippet;
		head: Snippet;
		children: Snippet;
		footer?: Snippet;
		emptyAction?: Snippet;
		/** Mobil (< 640 px): `scroll` = horizontal scrollen, `cards` = jede Zeile als Karte */
		mobile?: 'scroll' | 'cards';
	} = $props();

	let wrapper = $state<HTMLElement>();

	/**
	 * Karten-Modus: Beschriftung jeder Zelle aus dem passenden `<th>` (`data-label`, im CSS als `::before`).
	 * Zellen ohne Kopftext (Checkbox, Aktionen) bleiben ohne Label; `colspan` verschiebt die Spalte.
	 */
	function applyLabels() {
		if (!wrapper || mobile !== 'cards') return;
		const labels = [...wrapper.querySelectorAll('thead th')].map((th) =>
			(th.textContent ?? '').replace(/\s+/g, ' ').trim()
		);
		for (const row of wrapper.querySelectorAll('tbody tr')) {
			let col = 0;
			for (const cell of row.children) {
				const label = labels[col] ?? '';
				if (label && !cell.hasAttribute('data-label-manual'))
					cell.setAttribute('data-label', label);
				else if (!cell.hasAttribute('data-label-manual')) cell.removeAttribute('data-label');
				col += (cell as HTMLTableCellElement).colSpan || 1;
			}
		}
	}

	$effect(() => {
		if (!wrapper || mobile !== 'cards') return;
		applyLabels();
		// Zeilen kommen/gehen (Laden, Filter, Paging): Beschriftung nachziehen
		const observer = new MutationObserver(applyLabels);
		observer.observe(wrapper, { childList: true, subtree: true });
		return () => observer.disconnect();
	});
</script>

<Card.Root>
	{#if title}
		<Card.Header>
			<Card.Title level={titleLevel}>{title}</Card.Title>
			{#if description}<Card.Description>{description}</Card.Description>{/if}
		</Card.Header>
	{/if}
	<Card.Content class={title ? 'space-y-4' : 'space-y-4 pt-6'}>
		{#if toolbar}
			<div class="flex flex-wrap items-center gap-2">{@render toolbar()}</div>
		{/if}

		{#if error}
			<ErrorState message={error} {onretry} busy={loading} />
		{:else if loading && empty}
			<LoadingState label={caption} rows={skeletonRows} rowClass="h-10 w-full" />
		{:else if empty}
			<EmptyState title={emptyTitle} description={emptyDescription}>
				{#if emptyAction}{@render emptyAction()}{/if}
			</EmptyState>
		{:else}
			<div
				class="overflow-x-auto transition-opacity"
				class:opacity-60={loading}
				data-mobile={mobile}
				bind:this={wrapper}
			>
				<Table.Root aria-label={caption}>
					<Table.Header>{@render head()}</Table.Header>
					<Table.Body>{@render children()}</Table.Body>
				</Table.Root>
			</div>
		{/if}

		{#if footer}{@render footer()}{/if}
	</Card.Content>
</Card.Root>
