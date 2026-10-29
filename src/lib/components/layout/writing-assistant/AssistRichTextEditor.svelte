<script lang="ts">
	// `RichTextEditor` mit Schreibhilfe-Knopf rechts in der Werkzeugleiste. Übernehmen ersetzt den Text
	// als ein Schritt im Verlauf (Strg+Z holt den alten Text zurück).
	import type { ComponentProps } from 'svelte';
	import { RichTextEditor } from '$lib/components/ui/rich-text-editor';
	import type { AssistTask } from '$lib/sdk/types/assist';
	import AssistButton from './AssistButton.svelte';
	import type { AssistConfig } from './assist.svelte';

	let {
		value = $bindable(''),
		assist,
		assistTasks,
		...rest
	}: Omit<ComponentProps<typeof RichTextEditor>, 'value' | 'toolbarEnd'> & {
		value?: string;
		/** Textstelle für die Schreibhilfe; ohne Angabe ein normaler Editor */
		assist?: AssistConfig;
		assistTasks?: AssistTask[];
	} = $props();
</script>

{#if assist}
	<RichTextEditor bind:value {...rest}>
		{#snippet toolbarEnd({ getHtml, setHtml })}
			<AssistButton
				config={assist}
				tasks={assistTasks}
				disabled={rest.disabled === true}
				text={getHtml}
				onapply={setHtml}
			/>
		{/snippet}
	</RichTextEditor>
{:else}
	<RichTextEditor bind:value {...rest} />
{/if}
