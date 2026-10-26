<script lang="ts">
	// Eintrag in einem Aktionsblatt (`BottomSheet`): Symbol, Titel, Unterzeile; 60 px hoch.
	// `primary` = Hauptaktion (Symbol in Akzentfarbe), `danger` = Gefährliches (rot, ans Ende).
	import type { Component } from 'svelte';
	import { cn } from '$lib/utils.js';

	let {
		icon: Icon,
		title,
		description,
		variant = 'default',
		disabled = false,
		onclick,
		class: className
	}: {
		icon?: Component<{ class?: string }>;
		title: string;
		description?: string;
		variant?: 'default' | 'primary' | 'danger';
		disabled?: boolean;
		onclick: () => void;
		class?: string;
	} = $props();
</script>

<button
	type="button"
	data-slot="sheet-action"
	class={cn(
		'flex min-h-15 w-full items-center gap-3.5 px-5 py-2 text-left transition-colors hover:bg-muted active:bg-muted disabled:pointer-events-none disabled:opacity-50',
		variant === 'danger' && 'text-destructive',
		className
	)}
	{disabled}
	{onclick}
>
	{#if Icon}
		<span
			class={cn(
				'flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted',
				variant === 'primary' && 'bg-primary text-primary-foreground',
				variant === 'danger' && 'bg-destructive-muted'
			)}
			aria-hidden="true"
		>
			<Icon class="size-5" />
		</span>
	{/if}
	<span class="flex min-w-0 flex-1 flex-col gap-0.5">
		<span class="font-semibold">{title}</span>
		{#if description}
			<span
				class={cn('text-sm', variant === 'danger' ? 'text-destructive' : 'text-muted-foreground')}
				>{description}</span
			>
		{/if}
	</span>
</button>
