<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import ErrorState from './ErrorState.svelte';
	import LoadingState from './LoadingState.svelte';

	/**
	 * Einheitliche Dashboard-Kachel: Kopf mit Icon, Titel und optionalem Link („Alle anzeigen“),
	 * Lade-/Fehler-/Leerzustand und Inhalt. Für Listen `<ul class="divide-y">` mit Einträgen
	 * `py-2` verwenden; Kennzahlen als `text-2xl font-semibold tabular-nums`.
	 */
	let {
		title,
		description,
		icon: Icon,
		href,
		hrefLabel = 'Alle anzeigen',
		loading = false,
		error = '',
		onretry,
		empty = false,
		emptyText = 'Nichts Neues.',
		skeletonRows = 3,
		actions,
		children
	}: {
		title: string;
		description?: string;
		icon?: Component<{ class?: string }>;
		/** Link zur vollständigen Ansicht (rechts im Kopf) */
		href?: string;
		hrefLabel?: string;
		loading?: boolean;
		error?: string;
		onretry?: () => void;
		empty?: boolean;
		emptyText?: string;
		skeletonRows?: number;
		/** Zusätzliche Knöpfe im Kopf */
		actions?: Snippet;
		children?: Snippet;
	} = $props();
</script>

<Card.Root class="flex h-full flex-col gap-3 py-4">
	<Card.Header class="flex flex-row items-start justify-between gap-2 px-4">
		<div class="flex min-w-0 items-center gap-2">
			{#if Icon}
				<span
					class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-link"
					aria-hidden="true"
				>
					<Icon class="size-4" />
				</span>
			{/if}
			<div class="min-w-0">
				<Card.Title class="truncate">{title}</Card.Title>
				{#if description}<Card.Description class="text-xs">{description}</Card.Description>{/if}
			</div>
		</div>
		<div class="flex shrink-0 items-center gap-1">
			{#if actions}{@render actions()}{/if}
			{#if href}
				<Button
					{href}
					variant="ghost"
					size="sm"
					class="-mr-2 text-muted-foreground"
					aria-label={`${hrefLabel}: ${title}`}
				>
					<span class="hidden sm:inline">{hrefLabel}</span>
					<ArrowRight />
				</Button>
			{/if}
		</div>
	</Card.Header>
	<Card.Content class="flex-1 px-4 text-sm">
		{#if error}
			<ErrorState compact message={error} {onretry} />
		{:else if loading}
			<LoadingState label={title} rows={skeletonRows} />
		{:else if empty}
			<p class="text-muted-foreground">{emptyText}</p>
		{:else if children}
			{@render children()}
		{/if}
	</Card.Content>
</Card.Root>
