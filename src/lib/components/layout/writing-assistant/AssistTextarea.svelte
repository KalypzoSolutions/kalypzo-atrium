<script lang="ts">
	// Textarea mit Schreibhilfe-Knopf unten rechts. Ohne Freigabe sieht es aus wie eine normale Textarea.
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { AssistTask } from '$lib/sdk/types/assist';
	import AssistButton from './AssistButton.svelte';
	import type { AssistConfig } from './assist.svelte';

	let {
		value = $bindable(''),
		ref = $bindable(null),
		assist,
		assistTasks,
		source,
		onassist,
		onitems,
		class: className,
		...rest
	}: Omit<HTMLTextareaAttributes, 'value'> & {
		value?: string;
		ref?: HTMLTextAreaElement | null;
		/** Textstelle für die Schreibhilfe; ohne Angabe keine Schreibhilfe */
		assist?: AssistConfig;
		assistTasks?: AssistTask[];
		/** Text, aus dem Vorschläge entstehen (Standard: das Feld selbst), z. B. Kurztext aus dem Beitrag */
		source?: () => string;
		/** Nach dem Übernehmen (z. B. Autosave anstoßen) */
		onassist?: (value: string) => void;
		onitems?: (items: string[]) => void;
	} = $props();
</script>

<div class="relative">
	<Textarea bind:ref bind:value class={[assist && 'pr-10', className]} {...rest} />
	{#if assist}
		<div class="absolute right-1.5 bottom-1.5">
			<AssistButton
				config={assist}
				variant="icon"
				tasks={assistTasks}
				disabled={rest.disabled === true}
				text={() => (source ? source() : (value ?? ''))}
				onapply={(v) => {
					value = v;
					onassist?.(v);
				}}
				{onitems}
			/>
		</div>
	{/if}
</div>
