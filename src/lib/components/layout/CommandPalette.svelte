<script lang="ts">
	import { goto } from '$app/navigation';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { SEARCH_MIN_LENGTH, type SearchGroup, type SearchResponse } from '$lib/sdk/types/search';
	import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { Badge } from '$lib/components/ui/badge';
	import { Dialog, DialogContent, DialogTitle } from '$lib/components/ui/dialog';
	import {
		ADMIN_ENTRIES,
		ADMIN_SECTIONS,
		searchAdmin,
		visibleAdminEntries,
		type AdminEntry
	} from './admin-registry';
	import { iconFor } from './icons';
	import { PRIMARY_NAV, hasPermission, type ModuleNavEntry } from './nav';

	/** Treffer der Palette: Registry-Form (für `searchAdmin`) plus Gruppen-Badge und Kontext. */
	interface PaletteItem extends AdminEntry {
		group: string;
		context: string;
	}

	/** Höchstens so viele Seiten-Treffer (lokal); Datentreffer kommen gruppiert vom Server dazu */
	const MAX_RESULTS = 8;
	const DEBOUNCE_MS = 250;

	/** Ein Eintrag der Ergebnisliste (Seite oder Datensatz) */
	interface ResultRow {
		id: string;
		label: string;
		context: string;
		href: string;
		icon: string;
		badge: string;
		/** Überschrift, wenn die Gruppe hier beginnt */
		heading?: string;
	}

	let {
		permissions,
		navigation,
		open = $bindable(false)
	}: {
		permissions: string[];
		navigation: ModuleNavEntry[];
		open?: boolean;
	} = $props();

	let query = $state('');
	let active = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);
	const uid = $props.id();
	const listId = `${uid}-list`;

	const sectionLabel = (id: string) => ADMIN_SECTIONS.find((s) => s.id === id)?.label ?? '';

	const items = $derived.by((): PaletteItem[] => {
		const primary: PaletteItem[] = PRIMARY_NAV.filter((n) =>
			hasPermission(permissions, n.permission)
		).map((n) => ({
			id: `nav:${n.href}`,
			section: 'modules',
			label: n.label,
			description: '',
			href: n.href,
			icon: n.icon,
			keywords: ['Startseite'],
			group: 'Navigation',
			context: ''
		}));
		const modules: PaletteItem[] = navigation
			.filter((n) => !n.admin)
			.map((n) => {
				const name = n.moduleName ?? n.label;
				const context = name !== n.label ? name : (n.group ?? '');
				return {
					id: `mod:${n.moduleId}:${n.path}`,
					section: 'modules',
					label: n.label,
					description: context ? `Modul ${context}` : '',
					href: n.path,
					icon: n.icon,
					keywords: [name, n.moduleId, n.group ?? ''].filter(Boolean),
					group: 'Modul',
					context
				};
			});
		const admin: PaletteItem[] = visibleAdminEntries(permissions, navigation).map((e) => {
			const parent = e.parent ? ADMIN_ENTRIES.find((p) => p.id === e.parent) : undefined;
			return {
				...e,
				group: 'Verwaltung',
				context: parent ? `${sectionLabel(e.section)} › ${parent.label}` : sectionLabel(e.section)
			};
		});
		return [...primary, ...modules, ...admin];
	});

	const pageResults = $derived(searchAdmin(items, query).slice(0, MAX_RESULTS));

	// --- Datensuche (Server) -------------------------------------------------------
	let dataGroups = $state<SearchGroup[]>([]);
	let dataQuery = $state('');
	let searching = $state(false);
	let searchError = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	const trimmed = $derived(query.trim());

	function scheduleSearch() {
		clearTimeout(timer);
		controller?.abort();
		const q = trimmed;
		if (q.length < SEARCH_MIN_LENGTH) {
			dataGroups = [];
			dataQuery = '';
			searching = false;
			searchError = false;
			return;
		}
		searching = true;
		timer = setTimeout(() => void runSearch(q), DEBOUNCE_MS);
	}

	async function runSearch(q: string) {
		const ac = new AbortController();
		controller = ac;
		try {
			const res = await fetch(`/search?q=${encodeURIComponent(q)}`, {
				signal: ac.signal,
				headers: { accept: 'application/json' }
			});
			if (!res.ok) throw new Error(String(res.status));
			const body = (await res.json()) as { data: SearchResponse };
			if (ac.signal.aborted) return;
			dataGroups = body.data.groups;
			dataQuery = q;
			searchError = false;
		} catch (e) {
			if (ac.signal.aborted) return;
			console.error('Suche fehlgeschlagen', e);
			dataGroups = [];
			searchError = true;
		} finally {
			if (controller === ac) searching = false;
		}
	}

	/** Seiten zuerst, danach Datentreffer je Quelle (nur zum aktuellen Suchbegriff) */
	const results = $derived.by((): ResultRow[] => {
		const rows: ResultRow[] = pageResults.map((r, i) => ({
			id: r.id,
			label: r.label,
			context: r.context,
			href: r.href,
			icon: r.icon,
			badge: r.group,
			heading: i === 0 && trimmed ? 'Seiten' : undefined
		}));
		if (dataQuery && dataQuery === trimmed) {
			for (const g of dataGroups) {
				g.hits.forEach((h, i) =>
					rows.push({
						id: `data:${g.source}:${h.id}:${i}`,
						label: h.title,
						context: h.subtitle ?? '',
						href: h.href,
						icon: h.icon ?? g.source,
						badge: h.type,
						heading: i === 0 ? g.label : undefined
					})
				);
			}
		}
		return rows;
	});
	const activeIndex = $derived(Math.min(active, Math.max(results.length - 1, 0)));
	const optionId = (i: number) => `${uid}-opt-${i}`;

	function reset() {
		query = '';
		active = 0;
		clearTimeout(timer);
		controller?.abort();
		dataGroups = [];
		dataQuery = '';
		searching = false;
		searchError = false;
	}

	function onOpenChange(v: boolean) {
		if (!v) reset();
	}

	function select(item: ResultRow | undefined) {
		if (!item) return;
		open = false;
		reset();
		void goto(item.href);
	}

	function scrollActive() {
		queueMicrotask(() =>
			document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' })
		);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (results.length) active = (activeIndex + 1) % results.length;
			scrollActive();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (results.length) active = (activeIndex - 1 + results.length) % results.length;
			scrollActive();
		} else if (e.key === 'Home' && results.length) {
			e.preventDefault();
			active = 0;
			scrollActive();
		} else if (e.key === 'End' && results.length) {
			e.preventDefault();
			active = results.length - 1;
			scrollActive();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			select(results[activeIndex]);
		}
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			if (open) {
				open = false;
				reset();
			} else {
				reset();
				open = true;
			}
		}
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<Dialog bind:open {onOpenChange}>
	<DialogContent
		showCloseButton={false}
		class="top-[10dvh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
		onOpenAutoFocus={(e) => {
			e.preventDefault();
			inputEl?.focus();
		}}
	>
		<DialogTitle class="sr-only">Suchen</DialogTitle>
		<div class="flex items-center gap-2 border-b px-3">
			<SearchIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<input
				bind:this={inputEl}
				bind:value={query}
				type="text"
				role="combobox"
				aria-expanded="true"
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={results.length ? optionId(activeIndex) : undefined}
				aria-label="Suchen: Seiten, Mitglieder, Aktionen, Termine …"
				placeholder="Suchen: Seiten, Mitglieder, Aktionen …"
				autocomplete="off"
				spellcheck="false"
				class="h-12 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
				oninput={() => {
					active = 0;
					scheduleSearch();
				}}
				{onkeydown}
			/>
			{#if searching}
				<LoaderCircle
					class="size-4 shrink-0 animate-spin text-muted-foreground"
					aria-label="Sucht …"
				/>
			{/if}
			<kbd
				class="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground sm:inline"
				aria-hidden="true">Esc</kbd
			>
		</div>

		<ul
			id={listId}
			role="listbox"
			aria-label="Suchergebnisse"
			class="max-h-[min(60dvh,26rem)] overflow-y-auto p-1.5"
		>
			{#each results as r, i (r.id)}
				{@const Icon = iconFor(r.icon)}
				{#if r.heading}
					<li
						class="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground first:pt-1"
						role="presentation"
					>
						{r.heading}
					</li>
				{/if}
				<!-- Tastatur über das Eingabefeld (aria-activedescendant), Klick hier nur für Maus/Touch -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={optionId(i)}
					role="option"
					aria-selected={i === activeIndex}
					class="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 {i === activeIndex
						? 'bg-accent text-accent-foreground'
						: ''}"
					onmousemove={() => (active = i)}
					onclick={() => select(r)}
				>
					<Icon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium">{r.label}</span>
						{#if r.context}
							<span class="block truncate text-xs text-muted-foreground">{r.context}</span>
						{/if}
					</span>
					<Badge variant="outline" class="hidden sm:inline-flex">{r.badge}</Badge>
					{#if i === activeIndex}
						<CornerDownLeft class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
					{/if}
				</li>
			{:else}
				<li class="px-3 py-8 text-center text-sm text-muted-foreground" role="presentation">
					{#if searching}
						Sucht …
					{:else}
						Nichts gefunden. Versuch einen anderen Begriff.
					{/if}
				</li>
			{/each}
		</ul>
		{#if searchError}
			<p class="border-t px-3 py-2 text-xs text-destructive" role="alert">
				Datensuche gerade nicht möglich – es werden nur Seiten angezeigt.
			</p>
		{/if}
		<p class="sr-only" aria-live="polite">
			{trimmed && !searching ? `${results.length} Treffer` : ''}
		</p>
		<p class="border-t px-3 py-2 text-xs text-muted-foreground">
			<span class="hidden sm:inline">↑ ↓ zum Auswählen, Enter zum Öffnen, Esc zum Schließen</span>
			<span class="sm:hidden">Tippe, um zu suchen</span>
		</p>
	</DialogContent>
</Dialog>
