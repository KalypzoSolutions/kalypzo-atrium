<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	export interface ContactRow {
		name: string;
		value: string;
	}

	/**
	 * Einheitliche, dynamische Liste benannter Kontakte (Bezeichnung + Wert), z. B. Telefonnummern
	 * oder E-Mail-Adressen. Fehler je Zeile ueber `errors[index].name|value`.
	 */
	let {
		id,
		label,
		items = $bindable([]),
		type = 'text',
		valueLabel,
		valuePlaceholder,
		namePlaceholder = 'Bezeichnung, z. B. Mutter',
		addLabel = 'Hinzufügen',
		max = 10,
		errors = {},
		listError = null,
		disabled = false,
		readonly = false,
		emptyText = 'Keine Einträge.'
	}: {
		id: string;
		label: string;
		items?: ContactRow[];
		type?: 'tel' | 'email' | 'text';
		valueLabel: string;
		valuePlaceholder?: string;
		namePlaceholder?: string;
		addLabel?: string;
		max?: number;
		errors?: Record<number, { name?: string; value?: string }>;
		listError?: string | null;
		disabled?: boolean;
		/** Nur Ansicht: Felder gesperrt, ohne Hinzufügen/Entfernen */
		readonly?: boolean;
		/** Hinweis bei leerer Liste in der Ansicht */
		emptyText?: string;
	} = $props();

	const inputmode = $derived(type === 'tel' ? 'tel' : type === 'email' ? 'email' : undefined);
</script>

<fieldset class="grid gap-2" disabled={disabled || readonly}>
	<legend class="mb-1 text-sm font-medium">{label}</legend>

	{#each items as _, i (i)}
		{@const err = errors[i]}
		<div class="grid gap-1">
			<div class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start">
				<Input
					id="{id}-{i}-name"
					class="sm:w-2/5"
					placeholder={namePlaceholder}
					aria-label="Bezeichnung für {valueLabel} {i + 1}"
					aria-invalid={err?.name ? true : undefined}
					autocomplete="off"
					bind:value={items[i]!.name}
				/>
				<Input
					id="{id}-{i}-value"
					class="sm:flex-1"
					{type}
					{inputmode}
					placeholder={valuePlaceholder}
					aria-label="{valueLabel} {i + 1}"
					aria-invalid={err?.value ? true : undefined}
					aria-describedby={err?.value ? `${id}-${i}-error` : undefined}
					autocomplete="off"
					bind:value={items[i]!.value}
				/>
				{#if !readonly}
					<Button
						type="button"
						variant="ghost"
						class="self-end sm:self-auto"
						size="icon"
						aria-label="{valueLabel} {i + 1} entfernen"
						onclick={() => (items = items.filter((_, j) => j !== i))}
					>
						<Trash2 class="size-4" />
					</Button>
				{/if}
			</div>
			{#if err?.name || err?.value}
				<p id="{id}-{i}-error" role="alert" class="text-xs text-destructive">
					{err.value ?? err.name}
				</p>
			{/if}
		</div>
	{:else}
		{#if readonly}<p class="text-sm text-muted-foreground">{emptyText}</p>{/if}
	{/each}

	{#if !readonly && items.length < max}
		<div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={() => (items = [...items, { name: '', value: '' }])}
			>
				<Plus />
				{addLabel}
			</Button>
		</div>
	{/if}

	{#if listError}
		<p role="alert" class="text-xs text-destructive">{listError}</p>
	{/if}
</fieldset>
