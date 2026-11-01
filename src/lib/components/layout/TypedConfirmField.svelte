<!--
	Bestätigung per Eingabe eines festen Wortes (z. B. „ZURÜCKSETZEN“) vor unumkehrbaren Aktionen.
	`confirmed` wird erst bei exakt passender Eingabe (Groß-/Kleinschreibung, Unicode-normalisiert) true.
-->
<script lang="ts">
	import { t } from '$lib/i18n';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let {
		word,
		value = $bindable(''),
		// Nur-Ausgabe-Bindung: wird im $effect gesetzt, ESLint erkennt die Bindung nicht
		// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-useless-assignment
		confirmed = $bindable(false),
		id = 'typed-confirm',
		label,
		hint,
		disabled = false,
		alsoAccept = []
	}: {
		/** Wort, das exakt eingegeben werden muss */
		word: string;
		value?: string;
		/** true, sobald die Eingabe exakt dem Wort entspricht (nur lesen) */
		confirmed?: boolean;
		id?: string;
		label?: string;
		hint?: string;
		disabled?: boolean;
		/** Weitere gültige Wörter (z. B. das deutsche Bestätigungswort, das der Server immer annimmt) */
		alsoAccept?: string[];
	} = $props();

	const matches = $derived(
		[word, ...alsoAccept].some((w) => value.normalize('NFC') === w.normalize('NFC'))
	);

	// Ausgabewert für bind:confirmed synchron halten (einziger Effekt, keine Kette)
	$effect(() => {
		confirmed = matches;
	});

	const showMismatch = $derived(value.length > 0 && !matches && value.length >= word.length);
</script>

<div class="grid gap-1.5">
	<Label for={id}>
		{#if label}{label}{:else}{t('layout.typedConfirm.before')}
			<span class="font-mono font-semibold">{word}</span>
			{t('layout.typedConfirm.after')}{/if}
	</Label>
	<div class="relative">
		<Input
			{id}
			bind:value
			{disabled}
			autocomplete="off"
			autocapitalize="characters"
			spellcheck={false}
			placeholder={word}
			class="pr-9 font-mono tracking-wide"
			aria-invalid={showMismatch || undefined}
			aria-describedby="{id}-status"
		/>
		{#if matches}
			<CircleCheck
				class="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-success"
				aria-hidden="true"
			/>
		{/if}
	</div>
	<p
		id="{id}-status"
		aria-live="polite"
		class="text-xs {showMismatch ? 'text-destructive' : 'text-muted-foreground'}"
	>
		{#if matches}
			{t('layout.typedConfirm.confirmed')}
		{:else if showMismatch}
			{t('layout.typedConfirm.mismatch')}
		{:else}
			{hint ?? t('layout.typedConfirm.hint')}
		{/if}
	</p>
</div>
