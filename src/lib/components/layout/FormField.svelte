<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Label } from '$lib/components/ui/label';
	import { mergeIds, setFieldContext } from '$lib/components/ui/field/context';

	let {
		label,
		id,
		error,
		hint,
		required = false,
		children
	}: {
		label: string;
		/** ID des Steuerelements; Hinweis/Fehler bekommen `<id>-hint` / `<id>-error` */
		id: string;
		error?: string | null;
		hint?: string;
		/** Pflichtfeld: sichtbares `*` und `aria-required` am Steuerelement */
		required?: boolean;
		children: Snippet;
	} = $props();

	const hintId = $derived(`${id}-hint`);
	const errorId = $derived(`${id}-error`);

	// Eingabe-Bausteine im Feld lesen diesen Kontext und verknüpfen Hinweis/Fehler selbst (#51)
	setFieldContext({
		get id() {
			return id;
		},
		get describedby() {
			return mergeIds(hint && hintId, error && errorId);
		},
		get invalid() {
			return !!error;
		},
		get required() {
			return required;
		}
	});
</script>

<div class="grid content-start gap-1.5">
	<Label for={id}>
		{#if required}
			<span>{label}<span class="ml-0.5 text-destructive" aria-hidden="true">*</span></span>
		{:else}
			{label}
		{/if}
	</Label>
	{@render children()}
	{#if hint}<p id={hintId} class="text-xs text-muted-foreground">{hint}</p>{/if}
	{#if error}<p id={errorId} role="alert" class="text-xs text-destructive">{error}</p>{/if}
</div>
