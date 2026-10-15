<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';

	export interface SelectFieldOption {
		value: string;
		label: string;
	}

	/** Interner Wert fuer den "leer"-Eintrag (bits-ui kennt keinen leeren Wert) */
	const NONE = '__none__';

	let {
		options,
		value = $bindable(null),
		onchange,
		placeholder = 'Auswählen …',
		emptyLabel,
		label,
		id,
		name,
		required = false,
		disabled = false,
		invalid = false,
		size = 'default',
		class: className
	}: {
		options: SelectFieldOption[];
		/** `null` bzw. leerer String = keine Auswahl */
		value?: string | null;
		onchange?: (value: string | null) => void;
		placeholder?: string;
		/** Wenn gesetzt, gibt es einen Eintrag zum Zuruecksetzen (z. B. "Alle Stände") */
		emptyLabel?: string;
		/** Zugaengliche Bezeichnung (aria-label) */
		label: string;
		id?: string;
		/** Feldname fuer native Formular-Submits (SvelteKit-Actions); leer = kein Wert */
		name?: string;
		required?: boolean;
		disabled?: boolean;
		invalid?: boolean;
		size?: 'sm' | 'default';
		class?: string;
	} = $props();

	const internal = $derived(value ? value : emptyLabel ? NONE : '');
	const selectedLabel = $derived(
		value ? options.find((o) => o.value === value)?.label : emptyLabel
	);

	function change(v: string) {
		const next = v === NONE || v === '' ? null : v;
		value = next;
		onchange?.(next);
	}
</script>

<Select.Root type="single" value={internal} onValueChange={change} {disabled} {required} {name}>
	<Select.Trigger
		{id}
		{size}
		aria-label={label}
		aria-invalid={invalid || undefined}
		class={cn('w-full min-w-40', className)}
	>
		<span class={cn('truncate', !selectedLabel && 'text-muted-foreground')}>
			{selectedLabel ?? placeholder}
		</span>
	</Select.Trigger>
	<Select.Content>
		{#if emptyLabel}
			<Select.Item value={NONE} label={emptyLabel}>{emptyLabel}</Select.Item>
		{/if}
		{#each options as o (o.value)}
			<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
