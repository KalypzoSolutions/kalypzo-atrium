<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SearchX from '@lucide/svelte/icons/search-x';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import {
		ADMIN_SECTIONS,
		PageHeader,
		iconFor,
		searchAdmin,
		visibleAdminEntries,
		type AdminEntry
	} from '$lib/components/layout';

	let { data } = $props();

	const entries = $derived(visibleAdminEntries(data.permissions, data.navigation));
	const byId = $derived(new Map(entries.map((e) => [e.id, e])));
	const sectionLabel = (id: string) => ADMIN_SECTIONS.find((s) => s.id === id)?.label ?? '';

	let query = $state(page.url.searchParams.get('q') ?? '');
	let inputEl = $state<HTMLInputElement | null>(null);

	const trimmed = $derived(query.trim());
	const results = $derived(trimmed ? searchAdmin(entries, trimmed) : []);

	/** Abschnitte mit ihren Seiten; Reiter hängen unter der Elternseite. */
	const sections = $derived(
		ADMIN_SECTIONS.map((s) => {
			const inSection = entries.filter((e) => e.section === s.id);
			const ids = new Set(inSection.map((e) => e.id));
			const tops = inSection.filter((e) => !e.parent || !ids.has(e.parent));
			return {
				...s,
				pages: tops.map((e) => ({
					entry: e,
					tabs: inSection.filter((c) => c.parent === e.id)
				}))
			};
		}).filter((s) => s.pages.length > 0)
	);

	function context(e: AdminEntry): string {
		const parent = e.parent ? byId.get(e.parent) : undefined;
		return parent ? `${sectionLabel(e.section)} › ${parent.label}` : sectionLabel(e.section);
	}

	function syncUrl(q: string) {
		const url = new URL(page.url);
		if (q.trim()) url.searchParams.set('q', q.trim());
		else url.searchParams.delete('q');
		if (url.search === page.url.search) return;
		try {
			replaceState(url, {});
		} catch {
			// Router noch nicht bereit – URL-Abgleich ist optional.
		}
	}

	function oninput() {
		syncUrl(query);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && results[0]) {
			e.preventDefault();
			void goto(results[0].href);
		} else if (e.key === 'Escape' && query) {
			e.preventDefault();
			query = '';
			syncUrl('');
		}
	}

	onMount(() => {
		if (window.matchMedia('(min-width: 1024px)').matches) inputEl?.focus();
	});
</script>

<svelte:head><title>Verwaltung</title></svelte:head>

<PageHeader
	title="Verwaltung"
	description="Benutzer, Rollen, Einstellungen, Module und Schnittstellen an einem Ort."
/>

<div class="space-y-6">
	<div class="relative">
		<SearchIcon
			class="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
			aria-hidden="true"
		/>
		<Input
			bind:ref={inputEl}
			bind:value={query}
			type="search"
			class="h-11 pl-10 text-base md:text-base"
			placeholder="Einstellung suchen … (z. B. SMTP, Logo, IBAN)"
			aria-label="Einstellung suchen"
			aria-describedby="admin-search-hint"
			autocomplete="off"
			{oninput}
			{onkeydown}
		/>
		<p id="admin-search-hint" class="sr-only">Enter öffnet den ersten Treffer.</p>
	</div>

	{#if trimmed}
		{#if results.length}
			<Card>
				<CardContent class="p-0">
					<p class="px-4 pt-3 pb-1 text-xs text-muted-foreground" aria-live="polite">
						{results.length} Treffer – Enter öffnet den ersten.
					</p>
					<ul class="divide-y">
						{#each results as r, i (r.id)}
							{@const Icon = iconFor(r.icon)}
							<li>
								<a
									href={r.href}
									class="flex items-start gap-3 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:bg-muted/60 {i ===
									0
										? 'bg-muted/40'
										: ''}"
								>
									<Icon class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
									<span class="min-w-0 flex-1">
										<span class="block font-medium">{r.label}</span>
										<span class="block text-xs text-muted-foreground">{context(r)}</span>
										<span class="mt-0.5 block text-xs text-muted-foreground">{r.description}</span>
									</span>
									<ChevronRight
										class="mt-0.5 size-4 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
								</a>
							</li>
						{/each}
					</ul>
				</CardContent>
			</Card>
		{:else}
			<div
				class="flex flex-col items-center rounded-lg border border-dashed p-8 text-center"
				aria-live="polite"
			>
				<SearchX class="mb-2 size-8 text-muted-foreground" aria-hidden="true" />
				<p class="font-semibold">Nichts gefunden</p>
				<p class="mt-1 max-w-sm text-sm text-muted-foreground">
					Zu „{trimmed}“ gibt es keine Einstellung, auf die du Zugriff hast. Versuch einen anderen
					Begriff, z. B. „Mail“, „Rolle“ oder „Speicher“.
				</p>
			</div>
		{/if}
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each sections as s (s.id)}
				{@const SectionIcon = iconFor(s.icon)}
				<Card>
					<CardHeader>
						<CardTitle class="flex items-center gap-2">
							<SectionIcon class="size-4 text-muted-foreground" aria-hidden="true" />
							{s.label}
						</CardTitle>
						<p class="text-xs text-muted-foreground">{s.description}</p>
					</CardHeader>
					<CardContent>
						<ul class="space-y-1">
							{#each s.pages as p (p.entry.id)}
								<li>
									<a
										href={p.entry.href}
										class="-mx-2 block rounded-md px-2 py-1.5 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
									>
										<span class="block text-sm font-medium">{p.entry.label}</span>
										<span class="block text-xs text-muted-foreground">{p.entry.description}</span>
									</a>
									{#if p.tabs.length}
										<ul class="mt-0.5 mb-1 ml-2 space-y-0.5 border-l pl-2">
											{#each p.tabs as t (t.id)}
												<li>
													<a
														href={t.href}
														class="block rounded-md px-2 py-1 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
													>
														<span class="block text-sm">{t.label}</span>
														<span class="block text-xs text-muted-foreground">{t.description}</span>
													</a>
												</li>
											{/each}
										</ul>
									{/if}
								</li>
							{/each}
						</ul>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>
