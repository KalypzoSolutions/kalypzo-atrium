<script lang="ts">
	// Knopf „Schreibhilfe“ + Blatt. Unsichtbar, solange die Textstelle für die Person nicht freigegeben ist.
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';
	import type { AssistTask } from '$lib/sdk/types/assist';
	import WritingAssistant from './WritingAssistant.svelte';
	import { assistPurpose, type AssistConfig } from './assist.svelte';

	let {
		config,
		text,
		onapply,
		onitems,
		tasks,
		variant = 'toolbar',
		label = 'Schreibhilfe',
		disabled = false,
		class: className
	}: {
		config: AssistConfig;
		/** Aktueller Inhalt (wird beim Öffnen gelesen) */
		text: () => string;
		onapply: (value: string) => void;
		onitems?: (items: string[]) => void;
		/** Nur diese Aufgaben anbieten */
		tasks?: AssistTask[];
		/** `toolbar` = Text + Icon (Editor-Leiste), `icon` = nur Icon (in Feldern) */
		variant?: 'toolbar' | 'icon';
		label?: string;
		disabled?: boolean;
		class?: string;
	} = $props();

	const handle = assistPurpose(() => config);
	// Ohne erlaubte Aufgabe (z. B. nur Bildbeschreibung, Bilder aber gesperrt) kein Knopf
	const visibleTasks = $derived(
		(handle.info?.tasks ?? []).filter(
			(t) =>
				(!tasks || tasks.includes(t)) && (t !== 'alt-text' || handle.status?.allowImages === true)
		).length
	);
	let open = $state(false);
	let snapshot = $state('');

	function start() {
		snapshot = text();
		open = true;
	}
</script>

{#if handle.info && visibleTasks > 0}
	{#if variant === 'toolbar'}
		<Button
			type="button"
			variant="ghost"
			size="sm"
			class={cn('h-8 gap-1.5 px-2 text-link', className)}
			{disabled}
			onclick={start}
		>
			<SparklesIcon class="size-4" aria-hidden="true" />
			<span>{label}</span>
		</Button>
	{:else}
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			class={cn('text-link', className)}
			aria-label={label}
			title={label}
			{disabled}
			onclick={start}
		>
			<SparklesIcon class="size-4" aria-hidden="true" />
		</Button>
	{/if}
	<WritingAssistant
		bind:open
		{config}
		info={handle.info}
		address={handle.status?.address}
		allowImages={handle.status?.allowImages === true}
		text={snapshot}
		{tasks}
		{onapply}
		{onitems}
	/>
{/if}
