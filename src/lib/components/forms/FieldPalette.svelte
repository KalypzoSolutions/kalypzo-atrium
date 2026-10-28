<script module lang="ts">
	import type { Component } from 'svelte';
	import AlignLeft from '@lucide/svelte/icons/text-align-start';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Hash from '@lucide/svelte/icons/hash';
	import Heading from '@lucide/svelte/icons/heading';
	import Info from '@lucide/svelte/icons/info';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import ListTodo from '@lucide/svelte/icons/list-todo';
	import Mail from '@lucide/svelte/icons/mail';
	import Phone from '@lucide/svelte/icons/phone';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import SquareCheck from '@lucide/svelte/icons/square-check';
	import TextCursorInput from '@lucide/svelte/icons/text-cursor-input';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { iconFor } from '$lib/components/layout/icons';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type Icon = Component<any>;

	const TYPE_ICONS: Record<string, Icon> = {
		text: TextCursorInput,
		textarea: AlignLeft,
		number: Hash,
		email: Mail,
		phone: Phone,
		date: Calendar,
		select: ChevronDown,
		multiselect: ListChecks,
		boolean: SquareCheck,
		info: Info,
		section: Heading,
		consent: ShieldCheck
	};

	/** Icon eines Feldtyps (eigene Zuordnung je Typ, sonst über den Icon-Schlüssel der Registry). */
	export function fieldTypeIcon(spec: { type: string; icon: string }): Icon {
		return TYPE_ICONS[spec.type] ?? (spec.icon ? iconFor(spec.icon) : ListTodo);
	}
</script>

<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import Plus from '@lucide/svelte/icons/plus';
	import type { FieldType, FieldTypeSpec } from '$lib/forms';

	let {
		types,
		disabled = false,
		label = 'Feld hinzufügen',
		onadd
	}: {
		types: FieldTypeSpec[];
		disabled?: boolean;
		label?: string;
		onadd: (type: FieldType) => void;
	} = $props();

	const off = $derived(disabled || types.length === 0);
	/** Eingabefelder zuerst, dann Anzeige-Typen (Infotext, Abschnitt) */
	const groups = $derived([
		{ label: 'Eingabefelder', items: types.filter((t) => t.hasValue) },
		{ label: 'Text & Gliederung', items: types.filter((t) => !t.hasValue) }
	]);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger disabled={off}>
		{#snippet child({ props })}
			<Button {...props} variant="outline" class="min-h-10 gap-2" disabled={off}>
				<Plus />
				{label}
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content
		align="start"
		class="max-h-[min(28rem,70vh)] w-[min(22rem,calc(100vw-2rem))]"
	>
		{#each groups as g, gi (g.label)}
			{#if g.items.length}
				{#if gi > 0 && groups[0]!.items.length}<DropdownMenu.Separator />{/if}
				<DropdownMenu.Group>
					<DropdownMenu.GroupHeading class="text-xs font-medium text-muted-foreground">
						{g.label}
					</DropdownMenu.GroupHeading>
					{#each g.items as spec (spec.type)}
						{@const Icon = fieldTypeIcon(spec)}
						<DropdownMenu.Item
							class="items-start gap-3 py-2"
							onSelect={() => onadd(spec.type as FieldType)}
						>
							<Icon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							<span class="flex min-w-0 flex-col">
								<span class="text-sm font-medium">{spec.label}</span>
								{#if spec.description}
									<span class="text-xs text-muted-foreground">{spec.description}</span>
								{/if}
							</span>
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Group>
			{/if}
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
