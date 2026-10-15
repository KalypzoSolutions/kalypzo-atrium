<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { SelectField } from '$lib/components/ui/select-field';
	import type { ShareCandidate, ShareEntry, ShareLevel, ShareOwner } from './share-types';

	/**
	 * Inhalt der Freigabe: Benutzer suchen, mit einer Stufe hinzufuegen, Stufe aendern oder
	 * entfernen. Wird von `ShareDialog` (Dialog) und `ShareMenu` (Popover) verwendet. Die
	 * Persistenz liegt bei der aufrufenden Seite; Fehler der Callbacks werden hier angezeigt.
	 */
	let {
		shares,
		owner,
		levels,
		defaultLevel,
		canManage = true,
		search,
		onadd,
		onchange,
		onremove
	}: {
		shares: ShareEntry[];
		/** Optional: wird als erste Zeile mit Badge „Besitzer*in“ angezeigt */
		owner?: ShareOwner;
		levels: ShareLevel[];
		/** Vorauswahl beim Hinzufuegen (Standard: erste Stufe) */
		defaultLevel?: string;
		/** `false`: nur Anzeige ohne Aenderungsmoeglichkeit */
		canManage?: boolean;
		search: (query: string) => Promise<ShareCandidate[]>;
		onadd: (user: ShareCandidate, level: string) => Promise<void>;
		onchange: (userId: string, level: string) => Promise<void>;
		onremove: (userId: string) => Promise<void>;
	} = $props();

	const MIN_QUERY = 2;

	let query = $state('');
	let level = $state<string | null>(null);
	let results = $state<ShareCandidate[]>([]);
	let searching = $state(false);
	let busy = $state(false);
	let error = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	const effectiveLevel = $derived(level ?? defaultLevel ?? levels[0]?.value ?? '');
	const candidates = $derived(results.filter((r) => !shares.some((s) => s.userId === r.id)));
	const total = $derived(shares.length + (owner ? 1 : 0));

	function onquery() {
		clearTimeout(timer);
		error = '';
		const q = query.trim();
		if (q.length < MIN_QUERY) {
			results = [];
			searching = false;
			return;
		}
		searching = true;
		const mine = ++seq;
		timer = setTimeout(async () => {
			try {
				const found = await search(q);
				if (mine === seq) results = found;
			} catch (e) {
				if (mine === seq) error = message(e, 'Suche fehlgeschlagen');
			} finally {
				if (mine === seq) searching = false;
			}
		}, 250);
	}

	function message(e: unknown, fallback: string) {
		return e instanceof Error && e.message ? e.message : fallback;
	}

	async function run(fn: () => Promise<void>, fallback: string) {
		busy = true;
		error = '';
		try {
			await fn();
		} catch (e) {
			error = message(e, fallback);
		} finally {
			busy = false;
		}
	}

	const add = (user: ShareCandidate) =>
		run(async () => {
			await onadd(user, effectiveLevel);
			query = '';
			results = [];
		}, 'Freigabe fehlgeschlagen');
</script>

<div class="space-y-4">
	{#if canManage}
		<div class="space-y-2">
			<div class="flex flex-wrap items-center gap-2">
				<div class="relative min-w-40 flex-1">
					<Search
						class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						type="search"
						class="pl-8"
						placeholder="Name oder E-Mail suchen …"
						aria-label="Benutzer suchen"
						autocomplete="off"
						bind:value={query}
						oninput={onquery}
					/>
				</div>
				<div class="w-36">
					<SelectField
						class="min-w-0"
						label="Stufe für neue Freigabe"
						options={levels}
						value={effectiveLevel}
						onchange={(v) => (level = v)}
					/>
				</div>
			</div>

			{#if query.trim().length >= MIN_QUERY}
				<ul class="max-h-48 divide-y overflow-y-auto rounded-md border" aria-label="Suchergebnisse">
					{#if searching}
						<li class="px-3 py-2 text-sm text-muted-foreground">Suche …</li>
					{:else if candidates.length === 0}
						<li class="px-3 py-2 text-sm text-muted-foreground">Keine passenden Benutzer</li>
					{:else}
						{#each candidates as c (c.id)}
							<li class="flex items-center justify-between gap-2 px-3 py-2">
								<span class="min-w-0 text-sm">
									<span class="block truncate font-medium">{c.name}</span>
									{#if c.email}
										<span class="block truncate text-xs text-muted-foreground">{c.email}</span>
									{/if}
								</span>
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={busy}
									onclick={() => add(c)}
								>
									<UserPlus /> Hinzufügen
								</Button>
							</li>
						{/each}
					{/if}
				</ul>
			{:else if query.trim().length > 0}
				<p class="text-xs text-muted-foreground">Mindestens {MIN_QUERY} Zeichen eingeben.</p>
			{/if}
		</div>
	{/if}

	<div>
		<h3 class="mb-2 text-sm font-medium">Zugriff ({total})</h3>
		{#if total === 0}
			<p class="text-sm text-muted-foreground">Noch nicht freigegeben.</p>
		{:else}
			<ul class="max-h-72 divide-y overflow-y-auto rounded-md border">
				{#if owner}
					<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
						<span class="min-w-0 text-sm">
							<span class="block truncate font-medium">{owner.name}</span>
							{#if owner.email}
								<span class="block truncate text-xs text-muted-foreground">{owner.email}</span>
							{/if}
						</span>
						<Badge>Besitzer*in</Badge>
					</li>
				{/if}
				{#each shares as s (s.userId)}
					<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
						<span class="min-w-0 text-sm">
							<span class="block truncate font-medium">{s.name}</span>
							{#if s.email}
								<span class="block truncate text-xs text-muted-foreground">{s.email}</span>
							{/if}
						</span>
						{#if canManage}
							<div class="flex items-center gap-1">
								<div class="w-32">
									<SelectField
										class="min-w-0"
										label="Stufe für {s.name}"
										options={levels}
										value={s.level}
										disabled={busy}
										onchange={(v) =>
											v && run(() => onchange(s.userId, v), 'Änderung fehlgeschlagen')}
									/>
								</div>
								<Button
									type="button"
									size="icon"
									variant="ghost"
									aria-label="Freigabe für {s.name} entfernen"
									disabled={busy}
									onclick={() => run(() => onremove(s.userId), 'Entfernen fehlgeschlagen')}
								>
									<Trash2 class="size-4" />
								</Button>
							</div>
						{:else}
							<Badge variant="secondary">
								{levels.find((l) => l.value === s.level)?.label ?? s.level}
							</Badge>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if error}
		<p class="text-sm text-destructive" role="alert">{error}</p>
	{/if}
</div>
