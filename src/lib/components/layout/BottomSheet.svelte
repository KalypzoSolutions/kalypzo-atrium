<script lang="ts">
	import { t } from '$lib/i18n';
	// Blatt von unten (Handy): Griff + Kopf ziehen schließt, Hintergrund tippen schließt,
	// die Zurück-Geste schließt nur das Blatt (Verlaufseintrag per Shallow Routing).
	// Für Menüs (`SheetAction`), Filter (`ChoiceChips`) und kurze Formulare/Assistenten.
	import { untrack, type Snippet } from 'svelte';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { pushState } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import XIcon from '@lucide/svelte/icons/x';
	import { cn } from '$lib/utils.js';
	import { popSheetEntry, sheetsSettled } from './sheet-history';

	let {
		open = $bindable(false),
		title,
		description,
		size = 'auto',
		onback,
		backLabel = t('layout.back'),
		headerActions,
		footer,
		children,
		class: className,
		bodyClass,
		showClose = true
	}: {
		open?: boolean;
		title: string;
		/** Unterzeile im Kopf (z. B. Betrag und Fälligkeit) */
		description?: string;
		/** `auto` = so hoch wie der Inhalt (max. 88 %), `tall` = fast ganzer Bildschirm (Formulare) */
		size?: 'auto' | 'tall';
		/** Schritt zurück (Assistent) – zeigt links einen Pfeil */
		onback?: () => void;
		backLabel?: string;
		/** Knöpfe rechts im Kopf (z. B. „Zurücksetzen“) */
		headerActions?: Snippet;
		/** feste Fußzeile (Hauptaktion) */
		footer?: Snippet;
		children: Snippet;
		class?: string;
		bodyClass?: string;
		showClose?: boolean;
	} = $props();

	// --- Verlauf: Zurück schließt das Blatt -------------------------------------------
	/** eigene Ebene in `page.state.sheet`, 0 = kein Eintrag */
	let level = 0;
	let pushing = false;
	$effect(() => {
		const isOpen = open;
		untrack(() => {
			if (isOpen && level === 0 && !pushing) {
				// Erst warten, bis ein gerade geschlossenes Blatt seinen Eintrag entfernt hat
				// (Blatt → Blatt), sonst nähme dessen `history.back()` unseren neuen Eintrag weg.
				pushing = true;
				setTimeout(() => {
					void sheetsSettled().then(() => {
						pushing = false;
						if (!open || level !== 0) return;
						const next = (page.state.sheet ?? 0) + 1;
						try {
							pushState('', { ...page.state, sheet: next });
							level = next;
						} catch {
							// Router noch nicht bereit: Blatt ohne Verlaufseintrag
							level = 0;
						}
					});
				}, 0);
			} else if (!isOpen && level > 0) {
				const mine = level;
				level = 0;
				if ((page.state.sheet ?? 0) >= mine) popSheetEntry();
			}
		});
	});
	$effect(() => {
		const current = page.state.sheet ?? 0;
		untrack(() => {
			if (level > 0 && current < level) {
				level = 0;
				open = false;
			}
		});
	});

	// --- Ziehen zum Schließen ----------------------------------------------------------
	let dragY = $state(0);
	let dragging = $state(false);
	let startY = 0;
	let startT = 0;
	function dragStart(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		// Knöpfe im Kopf bleiben normal bedienbar
		if ((e.target as HTMLElement).closest('button, a, input')) return;
		dragging = true;
		startY = e.clientY;
		startT = performance.now();
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}
	function dragMove(e: PointerEvent) {
		if (dragging) dragY = Math.max(0, e.clientY - startY);
	}
	function dragEnd() {
		if (!dragging) return;
		const dt = Math.max(1, performance.now() - startT);
		const fast = dragY / dt > 0.6 && dragY > 30;
		if (dragY > 110 || fast) open = false;
		dragging = false;
		dragY = 0;
	}
</script>

<DialogPrimitive.Root bind:open>
	<DialogPrimitive.Portal>
		<DialogPrimitive.Overlay
			data-slot="bottom-sheet-overlay"
			class="fixed inset-0 z-50 bg-black/40 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
		/>
		<DialogPrimitive.Content
			data-slot="bottom-sheet"
			class={cn(
				'fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-2xl border-t bg-popover text-popover-foreground shadow-[0_-8px_30px_rgb(0_0_0/0.12)] outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom',
				size === 'tall' && 'h-[93dvh] max-h-[93dvh]',
				!dragging && 'transition-transform duration-200',
				className
			)}
			style={dragY ? `transform: translateY(${dragY}px)` : undefined}
		>
			<!-- Griff + Kopf: hier lässt sich das Blatt nach unten ziehen (nur Zusatz zu ✕, Escape, Hintergrund) -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="shrink-0 touch-none select-none"
				onpointerdown={dragStart}
				onpointermove={dragMove}
				onpointerup={dragEnd}
				onpointercancel={dragEnd}
			>
				<div class="mx-auto mt-2 mb-1 h-1.5 w-10 rounded-full bg-border" aria-hidden="true"></div>
				<div class="flex min-h-12 items-center gap-1 py-1 pr-2 {onback ? 'pl-1' : 'pl-5'}">
					{#if onback}
						<button
							type="button"
							class="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted"
							aria-label={backLabel}
							onclick={onback}
						>
							<ChevronLeft class="size-5" />
						</button>
					{/if}
					<div class="flex min-w-0 flex-1 flex-col gap-0.5 {onback ? 'pl-1' : ''}">
						<DialogPrimitive.Title class="truncate text-lg leading-tight font-semibold"
							>{title}</DialogPrimitive.Title
						>
						{#if description}
							<DialogPrimitive.Description class="truncate text-sm text-muted-foreground"
								>{description}</DialogPrimitive.Description
							>
						{/if}
					</div>
					{@render headerActions?.()}
					{#if showClose}
						<DialogPrimitive.Close
							class="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted"
						>
							<XIcon class="size-5" />
							<span class="sr-only">{t('layout.close')}</span>
						</DialogPrimitive.Close>
					{/if}
				</div>
			</div>
			<div
				class={cn(
					'min-h-0 flex-1 overflow-y-auto overscroll-contain',
					!footer && 'pb-[max(1rem,env(safe-area-inset-bottom))]',
					bodyClass
				)}
			>
				{@render children()}
			</div>
			{#if footer}
				<div class="safe-bottom shrink-0 border-t bg-popover px-4 pt-3">
					{@render footer()}
				</div>
			{/if}
		</DialogPrimitive.Content>
	</DialogPrimitive.Portal>
</DialogPrimitive.Root>
