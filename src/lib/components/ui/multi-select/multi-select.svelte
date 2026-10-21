<script lang="ts">
	import { appliesTo, claimFieldContext } from '$lib/components/ui/field/context';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import XIcon from '@lucide/svelte/icons/x';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { cn } from '$lib/utils.js';

	type Option = { value: string; label: string; description?: string };

	let {
		options,
		value = $bindable([]),
		onchange,
		placeholder = 'Auswählen …',
		searchPlaceholder = 'Suchen …',
		emptyText = 'Keine Treffer',
		label,
		id,
		disabled = false,
		invalid = false,
		class: className
	}: {
		options: Option[];
		value: string[];
		onchange?: (value: string[]) => void;
		placeholder?: string;
		searchPlaceholder?: string;
		emptyText?: string;
		label: string;
		id?: string;
		disabled?: boolean;
		invalid?: boolean;
		class?: string;
	} = $props();

	// Hinweis/Fehler des umgebenden FormField (#51); Kinder bekommen den Kontext nicht erneut
	const field = claimFieldContext();
	const fieldOwn = $derived(appliesTo(field, id) ? field : null);
	const isInvalid = $derived(invalid || !!fieldOwn?.invalid);

	const uid = $props.id();
	const listId = `${uid}-list`;
	const MAX_CHIPS = 3;

	let open = $state(false);
	let query = $state('');
	let active = $state(0);
	let listEl: HTMLElement | null = $state(null);

	const fold = (s: string) =>
		s.toLocaleLowerCase('de').replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '');

	const filtered = $derived.by(() => {
		const q = fold(query.trim());
		if (!q) return options;
		return options.filter((o) => fold(`${o.label} ${o.description ?? ''}`).includes(q));
	});
	const selected = $derived(options.filter((o) => value.includes(o.value)));
	const shownChips = $derived(selected.slice(0, MAX_CHIPS));
	const extra = $derived(selected.length - shownChips.length);

	function commit(next: string[]) {
		value = next;
		onchange?.(next);
	}
	function toggle(v: string) {
		commit(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
	}
	function remove(v: string) {
		commit(value.filter((x) => x !== v));
	}

	$effect(() => {
		if (open) {
			query = '';
			active = 0;
		}
	});
	$effect(() => {
		// Aktiven Eintrag im Sichtbereich halten
		void active;
		listEl
			?.querySelector<HTMLElement>('[data-active="true"]')
			?.scrollIntoView({ block: 'nearest' });
	});

	function onKeydown(e: KeyboardEvent) {
		const n = filtered.length;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (n) active = (active + 1) % n;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (n) active = (active - 1 + n) % n;
		} else if (e.key === 'Home' && n && query === '') {
			e.preventDefault();
			active = 0;
		} else if (e.key === 'End' && n && query === '') {
			e.preventDefault();
			active = n - 1;
		} else if (e.key === 'Enter' || (e.key === ' ' && query === '')) {
			e.preventDefault();
			const o = filtered[active];
			if (o) toggle(o.value);
		}
		// Esc wird von bits-ui (Popover) behandelt
	}
</script>

<div
	data-slot="multi-select"
	class={cn(
		'border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring flex min-h-8 w-full min-w-0 items-center rounded-lg border bg-transparent text-sm transition-colors focus-within:ring-3',
		isInvalid &&
			'border-destructive ring-destructive/20 dark:ring-destructive/40 dark:border-destructive/50 ring-3',
		disabled && 'pointer-events-none opacity-50',
		className
	)}
>
	{#if selected.length > 0}
		<div class="flex min-w-0 flex-wrap items-center gap-1 py-1 pl-1.5">
			{#each shownChips as chip (chip.value)}
				<span
					class="bg-secondary text-secondary-foreground inline-flex h-5 max-w-40 items-center gap-0.5 rounded-md pr-0.5 pl-1.5 text-xs"
				>
					<span class="truncate">{chip.label}</span>
					<button
						type="button"
						{disabled}
						aria-label={`${chip.label} entfernen`}
						class="hover:bg-foreground/10 focus-visible:ring-ring inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
						onclick={() => remove(chip.value)}
					>
						<XIcon class="size-3" />
					</button>
				</span>
			{/each}
			{#if extra > 0}
				<span class="text-muted-foreground px-1 text-xs">+{extra}</span>
			{/if}
		</div>
	{/if}
	<Popover.Root bind:open>
		<Popover.Trigger
			{id}
			{disabled}
			role="combobox"
			aria-label={label}
			aria-expanded={open}
			aria-haspopup="listbox"
			aria-controls={open ? listId : undefined}
			aria-invalid={isInvalid ? 'true' : undefined}
			aria-describedby={fieldOwn?.describedby}
			aria-required={fieldOwn?.required || undefined}
			class="flex min-h-8 min-w-8 flex-1 cursor-pointer items-center justify-between gap-1 self-stretch rounded-lg px-2 text-left outline-none"
		>
			{#if selected.length === 0}
				<span class="text-muted-foreground truncate">{placeholder}</span>
			{:else}
				<span class="sr-only">{selected.length} ausgewählt</span>
			{/if}
			<ChevronDownIcon class="text-muted-foreground ml-auto size-4 shrink-0" />
		</Popover.Trigger>
		<Popover.Content class="w-72 p-0" align="start">
			<div class="flex items-center gap-2 border-b px-2.5">
				<SearchIcon class="text-muted-foreground size-4 shrink-0" />
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="text"
					role="combobox"
					aria-label={searchPlaceholder}
					aria-expanded="true"
					aria-controls={listId}
					aria-autocomplete="list"
					aria-activedescendant={filtered[active]
						? `${uid}-opt-${filtered[active]!.value}`
						: undefined}
					autocomplete="off"
					autofocus
					placeholder={searchPlaceholder}
					bind:value={query}
					oninput={() => (active = 0)}
					onkeydown={onKeydown}
					class="placeholder:text-muted-foreground h-9 w-full bg-transparent text-sm outline-none"
				/>
			</div>
			<div
				bind:this={listEl}
				id={listId}
				role="listbox"
				tabindex="-1"
				aria-multiselectable="true"
				aria-label={label}
				class="max-h-64 overflow-y-auto p-1"
			>
				{#each filtered as o, i (o.value)}
					{@const checked = value.includes(o.value)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						id={`${uid}-opt-${o.value}`}
						role="option"
						aria-selected={checked}
						data-active={i === active}
						tabindex="-1"
						class={cn(
							'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm select-none',
							i === active && 'bg-accent text-accent-foreground'
						)}
						onpointermove={() => (active = i)}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => toggle(o.value)}
					>
						<span
							class={cn(
								'border-input mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
								checked && 'bg-primary text-primary-foreground border-primary'
							)}
							aria-hidden="true"
						>
							{#if checked}<CheckIcon class="size-3.5" />{/if}
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate">{o.label}</span>
							{#if o.description}
								<span class="text-muted-foreground block truncate text-xs">{o.description}</span>
							{/if}
						</span>
					</div>
				{:else}
					<p class="text-muted-foreground px-2 py-4 text-center text-sm">{emptyText}</p>
				{/each}
			</div>
			<div class="flex items-center justify-between border-t px-2.5 py-1.5 text-xs">
				<span class="text-muted-foreground" aria-live="polite">{value.length} ausgewählt</span>
				<button
					type="button"
					disabled={value.length === 0}
					class="text-foreground focus-visible:ring-ring rounded-sm outline-none hover:underline focus-visible:ring-2 disabled:no-underline disabled:opacity-50"
					onclick={() => commit([])}
				>
					Alle abwählen
				</button>
			</div>
		</Popover.Content>
	</Popover.Root>
</div>
