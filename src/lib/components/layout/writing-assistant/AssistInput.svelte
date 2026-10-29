<script lang="ts">
	// Einzeiliges Feld mit Schreibhilfe (Betreff, Titel, Thema): schlägt Varianten vor.
	// Quelle ist meist ein anderes Feld (z. B. der Nachrichtentext) – `source` liefert ihn.
	import { Input } from '$lib/components/ui/input';
	import { cn } from '$lib/utils.js';
	import type { AssistTask } from '$lib/sdk/types/assist';
	import AssistButton from './AssistButton.svelte';
	import type { AssistConfig } from './assist.svelte';

	let {
		value = $bindable(''),
		assist,
		assistTasks,
		source,
		onassist,
		id,
		name,
		maxlength,
		placeholder,
		autocomplete,
		disabled = false,
		required = false,
		class: className
	}: {
		value?: string;
		assist?: AssistConfig;
		assistTasks?: AssistTask[];
		/** Text, aus dem die Vorschläge entstehen (Standard: das Feld selbst) */
		source?: () => string;
		onassist?: (value: string) => void;
		id?: string;
		name?: string;
		maxlength?: number;
		placeholder?: string;
		autocomplete?: HTMLInputElement['autocomplete'];
		disabled?: boolean;
		required?: boolean;
		class?: string;
	} = $props();
</script>

<div class="relative">
	<Input
		bind:value
		{id}
		{name}
		{maxlength}
		{placeholder}
		{autocomplete}
		{disabled}
		{required}
		class={cn(assist && 'pr-10', className)}
	/>
	{#if assist}
		<div class="absolute top-1/2 right-1 -translate-y-1/2">
			<AssistButton
				config={assist}
				variant="icon"
				tasks={assistTasks}
				{disabled}
				text={() => (source ? source() : (value ?? ''))}
				onapply={(v) => {
					value = v;
					onassist?.(v);
				}}
			/>
		</div>
	{/if}
</div>
