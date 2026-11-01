<script lang="ts">
	import { t } from '$lib/i18n';
	// Auswahl eines Icons aus der ganzen Icon-Bibliothek (alle Lucide-Icons): Suche über englische Namen und
	// deutsche Begriffe, Vorschläge nach Themen, „Alle Icons“ schrittweise. Tastatur: Pfeiltasten im Raster
	// (ein Tab-Stopp), Enter/Leertaste wählt.
	import SearchIcon from '@lucide/svelte/icons/search';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { ICON_SUGGESTIONS, iconLabel, searchIcons } from '$lib/sdk/icons';
	import { cn } from '$lib/utils';
	import DynamicIcon from './dynamic-icon.svelte';
	import { iconStore } from './icons-state.svelte';

	const PAGE = 240;

	let {
		value = $bindable(null),
		onchange,
		label = t('icons.picker.search'),
		class: className
	}: {
		value?: string | null;
		onchange?: (value: string) => void;
		/** Zugänglicher Name des Suchfelds */
		label?: string;
		class?: string;
	} = $props();

	const uid = $props.id();

	let query = $state('');
	let shown = $state(PAGE);
	let focusKey = $state<string | null>(null);
	let root: HTMLElement | null = $state(null);

	$effect(() => {
		iconStore.ensure();
	});

	const set = $derived(iconStore.set);

	const suggestionGroups = $derived(
		set
			? ICON_SUGGESTIONS.map((g) => ({
					label: g.label,
					icons: g.icons.filter((n) => set.has(n))
				})).filter((g) => g.icons.length)
			: []
	);

	const results = $derived(set ? searchIcons(set, query) : []);
	const searching = $derived(query.trim().length > 0);

	/** Abschnitte in Anzeige-Reihenfolge (Schlüssel = Abschnitt:Name, ein Icon kann doppelt erscheinen) */
	const sections = $derived.by(() => {
		if (!set) return [];
		const main = { id: searching ? 'treffer' : 'alle', label: '', icons: results.slice(0, shown) };
		if (searching) {
			main.label = t('icons.picker.results', { count: results.length });
			return [main];
		}
		main.label = t('icons.picker.all', { count: set.names.length });
		return [
			...suggestionGroups.map((g) => ({ id: `s-${g.label}`, label: g.label, icons: g.icons })),
			main
		];
	});

	const keys = $derived(sections.flatMap((s) => s.icons.map((n) => `${s.id}:${n}`)));
	const rovingKey = $derived.by(() => {
		if (focusKey && keys.includes(focusKey)) return focusKey;
		const selected = value ? keys.find((k) => k.endsWith(`:${value}`)) : undefined;
		return selected ?? keys[0] ?? null;
	});

	function pick(name: string) {
		value = name;
		onchange?.(name);
	}

	function onSearchInput() {
		shown = PAGE;
		focusKey = null;
	}

	function buttons(): HTMLButtonElement[] {
		return root ? [...root.querySelectorAll<HTMLButtonElement>('[data-icon-key]')] : [];
	}

	/** Nächster Knopf in Zeile darüber/darunter mit kleinstem waagerechten Abstand */
	function vertical(list: HTMLButtonElement[], from: HTMLButtonElement, dir: 1 | -1) {
		const a = from.getBoundingClientRect();
		let best: HTMLButtonElement | null = null;
		let bestScore = Infinity;
		for (const el of list) {
			const b = el.getBoundingClientRect();
			const dy = (b.top - a.top) * dir;
			if (dy <= 2) continue;
			const score = dy * 1000 + Math.abs(b.left - a.left);
			if (score < bestScore) {
				bestScore = score;
				best = el;
			}
		}
		return best;
	}

	function onGridKeydown(e: KeyboardEvent) {
		const list = buttons();
		const current = e.target instanceof HTMLButtonElement ? e.target : null;
		const idx = current ? list.indexOf(current) : -1;
		if (idx < 0) return;
		let next: HTMLButtonElement | null | undefined;
		if (e.key === 'ArrowRight') next = list[idx + 1];
		else if (e.key === 'ArrowLeft') next = list[idx - 1];
		else if (e.key === 'ArrowDown') next = vertical(list, current!, 1);
		else if (e.key === 'ArrowUp') next = vertical(list, current!, -1);
		else if (e.key === 'Home') next = list[0];
		else if (e.key === 'End') next = list[list.length - 1];
		else return;
		e.preventDefault();
		if (!next) return;
		focusKey = next.dataset.iconKey ?? null;
		next.focus();
		next.scrollIntoView({ block: 'nearest' });
	}
</script>

<div class={cn('grid gap-3', className)}>
	<div class="relative">
		<SearchIcon
			class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
			aria-hidden="true"
		/>
		<Input
			id="{uid}-search"
			type="search"
			class="pl-8"
			placeholder={t('icons.picker.placeholder')}
			aria-label={label}
			autocomplete="off"
			bind:value={query}
			oninput={onSearchInput}
		/>
	</div>

	{#if iconStore.failed}
		<div class="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
			{t('icons.picker.loadFailed')}
			<Button variant="outline" size="sm" onclick={() => iconStore.ensure()}
				>{t('icons.picker.retry')}</Button
			>
		</div>
	{:else if !set}
		<div class="grid gap-2" role="status">
			<span class="sr-only">{t('icons.picker.loading')}</span>
			{#each [0, 1, 2] as i (i)}<Skeleton class="h-10 w-full" />{/each}
		</div>
	{:else}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div bind:this={root} class="grid gap-3" onkeydown={onGridKeydown}>
			{#each sections as section (section.id)}
				<section class="grid gap-1.5" aria-labelledby="{uid}-{section.id}">
					<h4 id="{uid}-{section.id}" class="text-xs font-medium text-muted-foreground">
						{section.label}
					</h4>
					{#if section.icons.length}
						<div class="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1">
							{#each section.icons as name (name)}
								{@const key = `${section.id}:${name}`}
								{@const selected = value === name}
								<button
									type="button"
									data-icon-key={key}
									tabindex={rovingKey === key ? 0 : -1}
									aria-pressed={selected}
									aria-label={iconLabel(name)}
									title={iconLabel(name)}
									class={cn(
										'flex size-10 items-center justify-center rounded-md border border-transparent text-foreground/80 transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
										selected && 'border-primary bg-primary/10 text-link'
									)}
									onclick={() => pick(name)}
									onfocus={() => (focusKey = key)}
								>
									<DynamicIcon {name} class="size-5" />
								</button>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">{t('icons.picker.none')}</p>
					{/if}
				</section>
			{/each}
			{#if results.length > shown}
				<Button
					variant="outline"
					size="sm"
					class="justify-self-center"
					onclick={() => (shown += PAGE)}
				>
					{t('icons.picker.more', { count: results.length - shown })}
				</Button>
			{/if}
		</div>
	{/if}
</div>
