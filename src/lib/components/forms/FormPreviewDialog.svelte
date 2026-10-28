<script lang="ts">
	/**
	 * Vollbild-Vorschau eines Formulars, wie Ausfüllende es sehen – umschaltbar zwischen Handy-, Tablet- und
	 * Desktop-Breite. Eingaben werden nur lokal gehalten (Pflichtprüfung per „Testweise absenden“).
	 */
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Tablet from '@lucide/svelte/icons/tablet';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import X from '@lucide/svelte/icons/x';
	import FormRenderer from './FormRenderer.svelte';
	import {
		emptyValues,
		validateFormValues,
		type FormDefinition,
		type FormValues
	} from '$lib/forms';

	let {
		open = $bindable(false),
		definition
	}: {
		open: boolean;
		definition: FormDefinition;
	} = $props();

	const uid = $props.id();
	type Device = 'phone' | 'tablet' | 'desktop';
	const DEVICES: { value: Device; label: string; width: string; icon: typeof Monitor }[] = [
		{ value: 'phone', label: 'Handy', width: 'max-w-[390px]', icon: Smartphone },
		{ value: 'tablet', label: 'Tablet', width: 'max-w-[768px]', icon: Tablet },
		{ value: 'desktop', label: 'Desktop', width: 'max-w-3xl', icon: Monitor }
	];

	let device = $state<Device>('desktop');
	let values = $state<FormValues>({});
	let errors = $state<Record<string, string>>({});
	let checked = $state(false);
	let renderer: { focusFirstError: () => boolean } | null = $state(null);

	const frame = $derived(DEVICES.find((d) => d.value === device)!.width);
	const hasFields = $derived(definition.fields.some((f) => !f.hidden));

	function reset() {
		values = emptyValues(definition);
		errors = {};
		checked = false;
	}

	$effect(() => {
		if (open) untrack(reset);
	});

	function trySubmit() {
		const r = validateFormValues(definition, values);
		checked = true;
		errors = r.ok ? {} : r.errors;
		if (!r.ok) queueMicrotask(() => renderer?.focusFirstError());
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		showCloseButton={false}
		class="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:max-w-none"
	>
		<header class="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2 sm:px-4">
			<div class="min-w-0 flex-1">
				<Dialog.Title class="text-base font-semibold">Vorschau</Dialog.Title>
				<Dialog.Description class="text-xs text-muted-foreground">
					So sehen Ausfüllende das Formular. Eingaben werden nicht gespeichert.
				</Dialog.Description>
			</div>
			<div class="flex items-center rounded-lg border p-0.5" role="radiogroup" aria-label="Breite">
				{#each DEVICES as d (d.value)}
					{@const Icon = d.icon}
					<button
						type="button"
						role="radio"
						aria-checked={device === d.value}
						class="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring {device ===
						d.value
							? 'bg-muted font-medium'
							: 'text-muted-foreground hover:text-foreground'}"
						onclick={() => (device = d.value)}
					>
						<Icon class="size-4" aria-hidden="true" />
						<span class="max-sm:sr-only">{d.label}</span>
					</button>
				{/each}
			</div>
			<Button variant="ghost" size="sm" onclick={reset}><RotateCcw /> Zurücksetzen</Button>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm"><X /> Schließen</Button>
				{/snippet}
			</Dialog.Close>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto bg-muted/40 px-3 py-6 sm:px-6">
			<div class="mx-auto w-full transition-[max-width] duration-200 {frame}">
				<div class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6">
					{#if definition.title}
						<h2 class="text-section">{definition.title}</h2>
					{/if}
					{#if definition.intro}
						<p class="mt-1 text-sm whitespace-pre-line text-muted-foreground">
							{definition.intro}
						</p>
					{/if}
					<div class={definition.title || definition.intro ? 'mt-5' : ''}>
						{#if !hasFields}
							<p class="text-sm text-muted-foreground">Das Formular hat noch keine Felder.</p>
						{:else}
							<FormRenderer
								bind:this={renderer}
								{definition}
								bind:values
								{errors}
								idPrefix="{uid}-fs"
							/>
						{/if}
					</div>
					{#if hasFields}
						<div class="mt-6 flex flex-wrap items-center gap-3">
							<Button onclick={trySubmit}>{definition.submitLabel || 'Absenden'}</Button>
							{#if checked}
								<p class="text-xs text-muted-foreground" aria-live="polite">
									{Object.keys(errors).length
										? `${Object.keys(errors).length} Angabe(n) fehlen oder sind ungültig.`
										: 'Alles ausgefüllt – in der Vorschau wird nichts abgeschickt.'}
								</p>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
