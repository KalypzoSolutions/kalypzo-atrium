<script lang="ts">
	import { untrack } from 'svelte';
	import { METHOD_BADGE_CLASS } from '$lib/api-docs/method-style';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { DataTable, EmptyState, PageTitle } from '$lib/components/layout';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { SelectField } from '$lib/components/ui/select-field';
	import { Switch } from '$lib/components/ui/switch';
	import * as Table from '$lib/components/ui/table';
	import {
		ACCESS_OPTIONS,
		API_METHODS,
		METHOD_OPTIONS,
		catalogStats,
		filterEntries,
		filterFromSearchParams,
		filterToSearchParams,
		groupEntries,
		moduleOptions
	} from '$lib/api-docs/filter';
	import type {
		ApiAccess,
		ApiCatalog,
		ApiCatalogEntry,
		ApiCatalogFilter,
		ApiMethod
	} from '$lib/api-docs/types';
	import EndpointSheet from './EndpointSheet.svelte';

	let { data }: { data: { catalog: ApiCatalog } } = $props();

	const catalog = $derived(data.catalog);

	// Startwerte aus der URL; danach lokaler Zustand (URL wird nur per replaceState nachgezogen)
	const initial = filterFromSearchParams(page.url.searchParams);
	let search = $state(initial.search ?? '');
	let moduleId = $state<string | null>(initial.moduleId ?? null);
	let method = $state<string | null>(initial.method ?? null);
	let access = $state<string | null>(initial.access ?? null);
	let onlyAllowed = $state(initial.onlyAllowed ?? false);

	// Deep-Link nur für bekannte Endpunkte öffnen
	const initialId = page.url.searchParams.get('endpoint');
	const initialKnown = untrack(
		() => initialId !== null && data.catalog.entries.some((e) => e.id === initialId)
	);
	let selectedId = $state<string | null>(initialKnown ? initialId : null);
	let sheetOpen = $state(initialKnown);

	const filter = $derived<ApiCatalogFilter>({
		search: search.trim() || undefined,
		moduleId,
		method: method as ApiMethod | null,
		access: access as ApiAccess | 'session' | null,
		onlyAllowed
	});

	const filtered = $derived(filterEntries(catalog.entries, filter));
	const grouped = $derived(groupEntries(catalog, filtered));
	const stats = $derived(catalogStats(catalog.entries));
	const modules = $derived(moduleOptions(catalog));
	const selected = $derived(
		selectedId ? (catalog.entries.find((e) => e.id === selectedId) ?? null) : null
	);
	const filterActive = $derived(
		!!filter.search || !!moduleId || !!method || !!access || onlyAllowed
	);
	const generatedAt = $derived(
		new Date(catalog.generatedAt).toLocaleString('de-DE', {
			dateStyle: 'medium',
			timeStyle: 'short'
		})
	);

	/** Alle Schlüssel, die der Filter in der URL belegen kann */
	const FILTER_KEYS = [
		...filterToSearchParams({
			search: 'x',
			moduleId: 'x',
			method: 'GET',
			access: 'public',
			onlyAllowed: true
		}).keys()
	];

	/** URL ohne Reload aktualisieren; fremde Parameter bleiben erhalten */
	function syncUrl() {
		const url = new URL(page.url);
		for (const key of FILTER_KEYS) url.searchParams.delete(key);
		for (const [key, value] of filterToSearchParams(filter)) url.searchParams.set(key, value);
		if (sheetOpen && selectedId) url.searchParams.set('endpoint', selectedId);
		else url.searchParams.delete('endpoint');
		if (url.search !== page.url.search) replaceState(url, page.state);
	}

	function resetFilters() {
		search = '';
		moduleId = null;
		method = null;
		access = null;
		onlyAllowed = false;
		syncUrl();
	}

	function openEntry(entry: ApiCatalogEntry) {
		selectedId = entry.id;
		sheetOpen = true;
		syncUrl();
	}

	function rowKey(e: KeyboardEvent, entry: ApiCatalogEntry) {
		if (e.target !== e.currentTarget) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openEntry(entry);
		}
	}

	function setSheetOpen(value: boolean) {
		sheetOpen = value;
		syncUrl();
	}

	const ACCESS_LABEL: Record<ApiAccess, string> = {
		public: 'Öffentlich',
		authenticated: 'Anmeldung',
		permission: 'Recht'
	};

	/** Pfad in Text- und Parameterteile zerlegen (`:name` hervorheben) */
	function pathParts(path: string): { text: string; param: boolean }[] {
		return path
			.split(/(:[A-Za-z0-9_]+)/)
			.filter((t) => t !== '')
			.map((text) => ({ text, param: text.startsWith(':') }));
	}
</script>

<PageTitle title="API-Übersicht" />

<div class="space-y-6">
	<div>
		<div class="mb-6 flex flex-wrap items-start justify-between gap-3">
			<div class="min-w-0">
				<h2 class="text-section">API-Übersicht</h2>
				<p class="text-sm text-muted-foreground">
					Alle REST-Endpunkte von Core und Modulen – automatisch aus dem Code erzeugt.
				</p>
			</div>
			<Button
				variant="outline"
				href="/api/v1/openapi.json"
				target="_blank"
				rel="noopener noreferrer"
			>
				<ExternalLink class="size-4" aria-hidden="true" />
				OpenAPI (JSON)
			</Button>
		</div>

		<div class="-mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
			<span
				><span class="font-medium text-foreground tabular-nums">{stats.total}</span> Endpunkte</span
			>
			<span class="flex flex-wrap items-center gap-1.5">
				{#each API_METHODS as m (m)}
					{#if stats.byMethod[m]}
						<span
							class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs {METHOD_BADGE_CLASS[
								m
							]}"
						>
							{m}<span class="tabular-nums">{stats.byMethod[m]}</span>
						</span>
					{/if}
				{/each}
			</span>
			<span
				><span class="font-medium text-foreground tabular-nums">{stats.publicCount}</span> öffentlich</span
			>
			<span
				><span class="font-medium text-foreground tabular-nums">{stats.allowedCount}</span> für dich aufrufbar</span
			>
			<span>Stand: {generatedAt}</span>
		</div>
	</div>

	<div
		class="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end"
		role="search"
	>
		<div class="space-y-1.5 sm:col-span-2 lg:col-span-1">
			<Label for="api-docs-search">Suche</Label>
			<Input
				id="api-docs-search"
				type="search"
				bind:value={search}
				oninput={syncUrl}
				placeholder="Pfad, Beschreibung, Recht …"
			/>
		</div>
		<div class="space-y-1.5">
			<Label for="api-docs-module">Modul</Label>
			<SelectField
				id="api-docs-module"
				label="Modul"
				options={modules}
				emptyLabel="Alle Module"
				bind:value={moduleId}
				onchange={syncUrl}
			/>
		</div>
		<div class="space-y-1.5">
			<Label for="api-docs-method">Methode</Label>
			<SelectField
				id="api-docs-method"
				label="Methode"
				options={METHOD_OPTIONS}
				emptyLabel="Alle Methoden"
				bind:value={method}
				onchange={syncUrl}
			/>
		</div>
		<div class="space-y-1.5">
			<Label for="api-docs-access">Zugriff</Label>
			<SelectField
				id="api-docs-access"
				label="Zugriff"
				options={ACCESS_OPTIONS}
				emptyLabel="Jeder Zugriff"
				bind:value={access}
				onchange={syncUrl}
			/>
		</div>
		<div class="flex h-9 items-center gap-2">
			<Switch
				id="api-docs-allowed"
				bind:checked={
					() => onlyAllowed,
					(v) => {
						onlyAllowed = v;
						syncUrl();
					}
				}
			/>
			<Label for="api-docs-allowed" class="whitespace-nowrap">Nur für mich aufrufbar</Label>
		</div>
	</div>

	<p class="text-xs text-muted-foreground" aria-live="polite">
		{filtered.length} von {catalog.entries.length} Endpunkten
		{#if filterActive}
			· <button
				type="button"
				class="underline underline-offset-2 hover:text-foreground"
				onclick={resetFilters}>Filter zurücksetzen</button
			>
		{/if}
	</p>

	{#if filtered.length === 0}
		<EmptyState
			title="Keine Endpunkte gefunden"
			description="Kein Endpunkt passt zu Suche und Filtern."
		>
			{#if filterActive}
				<Button variant="outline" onclick={resetFilters}>Filter zurücksetzen</Button>
			{/if}
		</EmptyState>
	{:else}
		{#each grouped as g (g.group.id)}
			<section aria-label={g.group.label}>
				<DataTable
					title={g.group.label}
					description={g.entries.length === 1 ? '1 Endpunkt' : `${g.entries.length} Endpunkte`}
					caption="Endpunkte: {g.group.label}"
					mobile="cards"
				>
					{#snippet head()}
						<Table.Row>
							<Table.Head class="w-20">Methode</Table.Head>
							<Table.Head>Pfad</Table.Head>
							<Table.Head>Beschreibung</Table.Head>
							<Table.Head>Zugriff</Table.Head>
							<Table.Head>Hinweise</Table.Head>
						</Table.Row>
					{/snippet}
					{#each g.entries as entry (entry.id)}
						<Table.Row
							class="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
							tabindex={0}
							aria-label="{entry.method} {entry.path} – Details öffnen"
							onclick={() => openEntry(entry)}
							onkeydown={(e) => rowKey(e, entry)}
						>
							<Table.Cell>
								<span
									class="inline-flex min-w-14 justify-center rounded-md border px-1.5 py-0.5 font-mono text-xs font-semibold {METHOD_BADGE_CLASS[
										entry.method
									]}">{entry.method}</span
								>
							</Table.Cell>
							<Table.Cell class="font-mono text-xs break-all whitespace-normal">
								{#each pathParts(entry.path) as part, i (i)}
									{#if part.param}<span class="font-semibold text-link">{part.text}</span
										>{:else}{part.text}{/if}
								{/each}
							</Table.Cell>
							<Table.Cell class="min-w-48 whitespace-normal">{entry.summary}</Table.Cell>
							<Table.Cell class="whitespace-normal">
								<div class="flex flex-col items-start gap-1">
									<Badge variant={entry.access === 'public' ? 'default' : 'secondary'}
										>{ACCESS_LABEL[entry.access]}</Badge
									>
									{#if entry.permission}
										<code class="text-xs whitespace-nowrap text-muted-foreground"
											>{entry.permission}</code
										>
									{/if}
								</div>
							</Table.Cell>
							<Table.Cell class="whitespace-normal">
								<div class="flex flex-wrap gap-1">
									{#if !entry.moduleEnabled}
										<Badge variant="outline" class="text-muted-foreground">Modul inaktiv</Badge>
									{/if}
									{#if !entry.allowed && entry.moduleEnabled}
										<Badge variant="destructive">Recht fehlt</Badge>
									{/if}
									{#if entry.sessionOnly}
										<Badge variant="outline">Nur Session</Badge>
									{/if}
									{#if entry.multipart}
										<Badge variant="outline">multipart</Badge>
									{/if}
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</DataTable>
			</section>
		{/each}
	{/if}
</div>

<EndpointSheet entry={selected} bind:open={() => sheetOpen, setSheetOpen} />
