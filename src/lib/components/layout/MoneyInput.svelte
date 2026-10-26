<script lang="ts">
	import { appliesTo, claimFieldContext } from '$lib/components/ui/field/context';
	import { cn } from '$lib/utils';
	import { formatCents, parseEuroToCents } from './money';

	let {
		cents = $bindable(0),
		label,
		id,
		disabled = false,
		invalid = false,
		max = 100_000_000,
		onchange,
		class: className,
		placeholder = '0,00'
	}: {
		/** Betrag in Cent (Integer) */
		cents?: number;
		/** Zugängliche Bezeichnung (aria-label) */
		label: string;
		id?: string;
		disabled?: boolean;
		invalid?: boolean;
		/** Obergrenze in Cent */
		max?: number;
		onchange?: (cents: number) => void;
		class?: string;
		placeholder?: string;
	} = $props();

	// Hinweis/Fehler des umgebenden FormField (#51); Kinder bekommen den Kontext nicht erneut
	const field = claimFieldContext();
	const fieldOwn = $derived(appliesTo(field, id) ? field : null);
	const isInvalid = $derived(invalid || !!fieldOwn?.invalid);

	let focused = $state(false);
	/** seit dem Fokussieren selbst getippt (dann gewinnt die Eingabe bis zum Verlassen) */
	let typing = $state(false);
	let text = $state('');

	// Externe Änderungen übernehmen, solange nicht getippt wird (auch bei Fokus, z. B. Autofokus im Dialog)
	$effect(() => {
		const c = cents;
		if (!focused || !typing) text = formatCents(c);
	});

	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		const cleaned = e.currentTarget.value.replace(/[^0-9.,]/g, '');
		typing = true;
		text = cleaned;
		e.currentTarget.value = cleaned;
	}

	function commit() {
		typing = false;
		const parsed = parseEuroToCents(text);
		const next = Math.min(Math.max(parsed ?? 0, 0), max);
		text = formatCents(next);
		if (next !== cents) {
			cents = next;
			onchange?.(next);
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') commit();
	}
</script>

<div
	class={cn(
		'border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring flex h-8 w-full min-w-28 items-center rounded-lg border bg-transparent px-2.5 transition-colors focus-within:ring-3',
		isInvalid &&
			'border-destructive ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40 ring-3',
		disabled && 'pointer-events-none cursor-not-allowed opacity-50',
		className
	)}
>
	<input
		{id}
		type="text"
		inputmode="decimal"
		autocomplete="off"
		aria-label={label}
		aria-invalid={isInvalid || undefined}
		aria-describedby={fieldOwn?.describedby}
		aria-required={fieldOwn?.required || undefined}
		{disabled}
		{placeholder}
		value={text}
		{oninput}
		{onkeydown}
		onfocus={(e) => {
			focused = true;
			e.currentTarget.select();
		}}
		onblur={() => {
			focused = false;
			commit();
		}}
		class="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent py-1 text-right text-base tabular-nums outline-none md:text-sm"
	/>
	<span class="text-muted-foreground ml-1.5 text-sm" aria-hidden="true">€</span>
</div>
