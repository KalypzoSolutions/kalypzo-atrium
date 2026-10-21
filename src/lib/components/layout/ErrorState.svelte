<script lang="ts">
	import type { Snippet } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';

	/**
	 * Einheitlicher Fehlerzustand beim Laden: Titel, Meldung, „Erneut versuchen“ (`onretry`) und optionale
	 * Details. Nach einem Ladefehler statt der Inhalte zeigen – nie leere Daten rendern.
	 * `compact` = einzeilig (Kacheln, Tabellenkarten), sonst Box mit Rahmen.
	 */
	let {
		title = 'Laden fehlgeschlagen',
		message,
		onretry,
		retryLabel = 'Erneut versuchen',
		busy = false,
		compact = false,
		details,
		class: className
	}: {
		title?: string;
		/** Fehlermeldung (z. B. `ApiClientError.message`) */
		message?: string | null;
		onretry?: () => void | Promise<void>;
		retryLabel?: string;
		/** Wiederholung läuft (Knopf gesperrt) */
		busy?: boolean;
		compact?: boolean;
		/** Zusätzliche Inhalte (z. B. Anfrage-ID, Hilfelink) */
		details?: Snippet;
		class?: string;
	} = $props();
</script>

{#if compact}
	<div
		data-slot="error-state"
		role="alert"
		class={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-destructive', className)}
	>
		<CircleAlert class="size-4 shrink-0" aria-hidden="true" />
		<span>{message || title}</span>
		{#if onretry}
			<Button size="sm" variant="link" class="h-auto p-0" disabled={busy} onclick={onretry}>
				{busy ? 'Lädt …' : retryLabel}
			</Button>
		{/if}
		{#if details}<div class="w-full text-xs text-muted-foreground">{@render details()}</div>{/if}
	</div>
{:else}
	<div
		data-slot="error-state"
		role="alert"
		class={cn(
			'flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive-border bg-destructive-muted p-6 text-center',
			className
		)}
	>
		<CircleAlert class="size-6 text-destructive" aria-hidden="true" />
		<p class="font-medium text-destructive">{title}</p>
		{#if message}<p class="max-w-md text-sm text-foreground">{message}</p>{/if}
		{#if details}<div class="text-xs text-muted-foreground">{@render details()}</div>{/if}
		{#if onretry}
			<Button size="sm" variant="outline" class="mt-1" disabled={busy} onclick={onretry}>
				<RotateCw aria-hidden="true" />
				{busy ? 'Lädt …' : retryLabel}
			</Button>
		{/if}
	</div>
{/if}
