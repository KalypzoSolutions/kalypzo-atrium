<script lang="ts">
	import type { Component } from 'svelte';
	import ContactRound from '@lucide/svelte/icons/contact-round';
	import Search from '@lucide/svelte/icons/search';
	import Shield from '@lucide/svelte/icons/shield';
	import Tent from '@lucide/svelte/icons/tent';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import User from '@lucide/svelte/icons/user';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Users from '@lucide/svelte/icons/users';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { SelectField } from '$lib/components/ui/select-field';
	import { contrastTextColor } from '$lib/components/ui/color-picker/color';
	import {
		shareInitials,
		shareKey,
		type ShareCandidate,
		type ShareEntry,
		type ShareLevel,
		type ShareOwner,
		type ShareTargetType
	} from './share-types';

	/**
	 * Inhalt der Freigabe: Ziele (Benutzer*innen oder – mit `type` – Stamm, Gruppen, Rollen,
	 * Mitglieder) suchen, mit einer Stufe hinzufügen, Stufe ändern oder entfernen. Wird von
	 * `ShareDialog` (Dialog) und `ShareMenu` (Popover) verwendet. Die Persistenz liegt bei der
	 * aufrufenden Seite; Fehler der Callbacks werden hier angezeigt.
	 *
	 * `onchange`/`onremove` bekommen den Schlüssel aus `shareKey` – ohne `type` ist das die
	 * reine Benutzer-ID (bisheriges Verhalten), mit `type` `typ:id`.
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
		onremove,
		everyoneLabel,
		placeholder = 'Name oder E-Mail suchen …',
		searchLabel = 'Benutzer suchen',
		emptyResultText = 'Keine passenden Benutzer'
	}: {
		shares: ShareEntry[];
		/** Optional: wird als erste Zeile mit Badge „Besitzer*in“ angezeigt */
		owner?: ShareOwner;
		levels: ShareLevel[];
		/** Vorauswahl beim Hinzufügen (Standard: erste Stufe) */
		defaultLevel?: string;
		/** `false`: nur Anzeige ohne Änderungsmöglichkeit */
		canManage?: boolean;
		search: (query: string) => Promise<ShareCandidate[]>;
		onadd: (user: ShareCandidate, level: string) => Promise<void>;
		/** `key` = `shareKey(entry)` (ohne `type`: Benutzer-ID) */
		onchange: (key: string, level: string) => Promise<void>;
		/** `key` = `shareKey(entry)` (ohne `type`: Benutzer-ID) */
		onremove: (key: string) => Promise<void>;
		/** Gesetzt: Schnellknopf „{everyoneLabel} (alle)“ für eine Freigabe an alle (`type: 'everyone'`) */
		everyoneLabel?: string;
		/** Platzhalter des Suchfelds */
		placeholder?: string;
		/** Zugänglicher Name des Suchfelds */
		searchLabel?: string;
		/** Hinweis, wenn die Suche nichts (Neues) findet */
		emptyResultText?: string;
	} = $props();

	const MIN_QUERY = 2;
	const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

	const TYPE_META: Record<ShareTargetType, { label: string; icon: Component }> = {
		everyone: { label: 'Stamm', icon: Tent },
		group: { label: 'Gruppe', icon: Users },
		role: { label: 'Rolle', icon: Shield },
		user: { label: 'Benutzer*in', icon: User },
		member: { label: 'Mitglied', icon: ContactRound }
	};

	let query = $state('');
	let level = $state<string | null>(null);
	let results = $state<ShareCandidate[]>([]);
	let searching = $state(false);
	let busy = $state(false);
	let error = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	const effectiveLevel = $derived(level ?? defaultLevel ?? levels[0]?.value ?? '');
	const sharedKeys = $derived(new Set(shares.map((s) => shareKey(s))));
	const candidates = $derived(results.filter((r) => !sharedKeys.has(shareKey(r))));
	const total = $derived(shares.length + (owner ? 1 : 0));
	const showEveryone = $derived(
		!!everyoneLabel && canManage && !shares.some((s) => s.type === 'everyone')
	);

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

	const addEveryone = () =>
		run(
			() => onadd({ id: '*', type: 'everyone', name: everyoneLabel ?? 'Stamm' }, effectiveLevel),
			'Freigabe fehlgeschlagen'
		);
</script>

{#snippet identity(item: {
	type?: ShareTargetType;
	name: string;
	email?: string | null;
	detail?: string | null;
	color?: string | null;
	image?: string | null;
})}
	{@const meta = item.type ? TYPE_META[item.type] : undefined}
	{@const Icon = meta?.icon ?? User}
	{@const sub = item.detail ?? item.email}
	<span class="flex min-w-0 flex-1 items-center gap-2 text-sm">
		{#if item.type === 'everyone' || item.type === 'role'}
			<!-- Ziele ohne Person/Bild: Typ-Icon -->
			<span
				class="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
				aria-hidden="true"
			>
				<Icon class="size-4" />
			</span>
		{:else}
			<!-- Personen und Gruppen: Avatar wie im Seitenkopf (Bild, sonst Initialen) -->
			<Avatar class="size-7" aria-hidden="true">
				{#if item.image}
					<AvatarImage src={item.image} alt="" />
				{/if}
				<AvatarFallback
					class="text-xs"
					style={item.type === 'group' && item.color && COLOR_RE.test(item.color)
						? `background-color:${item.color};color:${contrastTextColor(item.color)}`
						: undefined}
				>
					{shareInitials(item.name)}
				</AvatarFallback>
			</Avatar>
		{/if}
		<span class="min-w-0">
			<span class="flex min-w-0 items-center gap-1.5">
				{#if item.color && COLOR_RE.test(item.color) && item.type !== 'group'}
					<span
						class="size-2.5 shrink-0 rounded-full border border-border"
						style="background-color:{item.color}"
						aria-hidden="true"
					></span>
				{/if}
				<span class="truncate font-medium">{item.name}</span>
				{#if meta}
					<Badge variant="outline" class="px-1.5 text-xs font-normal">{meta.label}</Badge>
				{/if}
			</span>
			{#if sub}
				<span class="block truncate text-xs text-muted-foreground">{sub}</span>
			{/if}
		</span>
	</span>
{/snippet}

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
						{placeholder}
						aria-label={searchLabel}
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

			{#if showEveryone}
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={busy}
					aria-label="Für {everyoneLabel} (alle) freigeben"
					onclick={addEveryone}
				>
					<Tent />
					{everyoneLabel} (alle)
				</Button>
			{/if}

			{#if query.trim().length >= MIN_QUERY}
				<ul class="max-h-48 divide-y overflow-y-auto rounded-md border" aria-label="Suchergebnisse">
					{#if searching}
						<li class="px-3 py-2 text-sm text-muted-foreground">Suche …</li>
					{:else if candidates.length === 0}
						<li class="px-3 py-2 text-sm text-muted-foreground">{emptyResultText}</li>
					{:else}
						{#each candidates as c (shareKey(c))}
							<li class="flex items-center justify-between gap-2 px-3 py-2">
								{@render identity(c)}
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={busy}
									aria-label="{c.name} hinzufügen"
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
						{@render identity({ name: owner.name, email: owner.email, image: owner.image })}
						<Badge>Besitzer*in</Badge>
					</li>
				{/if}
				{#each shares as s (shareKey(s))}
					<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
						{@render identity(s)}
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
											v && run(() => onchange(shareKey(s), v), 'Änderung fehlgeschlagen')}
									/>
								</div>
								<Button
									type="button"
									size="icon"
									variant="ghost"
									aria-label="Freigabe für {s.name} entfernen"
									disabled={busy}
									onclick={() => run(() => onremove(shareKey(s)), 'Entfernen fehlgeschlagen')}
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
