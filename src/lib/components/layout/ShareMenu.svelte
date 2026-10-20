<script lang="ts">
	import type { Component } from 'svelte';
	import Share2 from '@lucide/svelte/icons/share-2';
	import Shield from '@lucide/svelte/icons/shield';
	import Tent from '@lucide/svelte/icons/tent';
	import Users from '@lucide/svelte/icons/users';
	import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import SharePanel from './SharePanel.svelte';
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
	 * Freigabe-Menü für Seitenköpfe: Button mit Avatar-Stapel der Personen mit Zugriff; ein
	 * Klick öffnet ein Popover (rechtsbündig) mit `SharePanel`. Gedacht für die Aktionsleiste
	 * neben „Bearbeiten“/„Löschen“.
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
		title = 'Zugriff',
		description = 'Wer diese Aktion sehen oder bearbeiten darf.',
		label = 'Teilen',
		maxAvatars = 3,
		everyoneLabel,
		placeholder,
		searchLabel,
		emptyResultText
	}: {
		shares: ShareEntry[];
		owner?: ShareOwner;
		levels: ShareLevel[];
		defaultLevel?: string;
		canManage?: boolean;
		search: (query: string) => Promise<ShareCandidate[]>;
		onadd: (user: ShareCandidate, level: string) => Promise<void>;
		/** `key` = `shareKey(entry)` (ohne `type`: Benutzer-ID) */
		onchange: (key: string, level: string) => Promise<void>;
		/** `key` = `shareKey(entry)` (ohne `type`: Benutzer-ID) */
		onremove: (key: string) => Promise<void>;
		title?: string;
		description?: string;
		label?: string;
		maxAvatars?: number;
		/** Siehe `SharePanel` */
		everyoneLabel?: string;
		placeholder?: string;
		searchLabel?: string;
		emptyResultText?: string;
	} = $props();

	/** Ziele ohne Personenbezug: im Avatar-Stapel als Typ-Icon statt Initialen */
	const TYPE_ICONS: Partial<Record<ShareTargetType, Component>> = {
		everyone: Tent,
		group: Users,
		role: Shield
	};

	let open = $state(false);

	const people = $derived<
		{ key: string; name: string; type?: ShareTargetType; image?: string | null }[]
	>([
		...(owner ? [{ key: 'owner', name: owner.name, image: owner.image }] : []),
		...shares.map((s) => ({ key: shareKey(s), name: s.name, type: s.type, image: s.image }))
	]);
	const visible = $derived(people.slice(0, maxAvatars));
	const hidden = $derived(Math.max(0, people.length - visible.length));
	/** Nur Personen (ohne Typ, Benutzer*innen, Mitglieder) → „Personen“, sonst „Freigaben“ */
	const onlyPersons = $derived(
		shares.every((s) => !s.type || s.type === 'user' || s.type === 'member')
	);
	const summary = $derived(
		people.length <= 1 && onlyPersons
			? 'Nur du hast Zugriff'
			: onlyPersons
				? `${people.length} Personen haben Zugriff: ${people.map((p) => p.name).join(', ')}`
				: `${people.length} ${people.length === 1 ? 'Freigabe' : 'Freigaben'}: ${people.map((p) => p.name).join(', ')}`
	);
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" class="gap-2" aria-label="{label}: {summary}">
				{#if people.length > 0}
					<AvatarGroup class="-space-x-1.5">
						{#each visible as p (p.key)}
							{@const Icon = p.type ? TYPE_ICONS[p.type] : undefined}
							<Avatar class="size-6">
								{#if p.image}
									<AvatarImage src={p.image} alt="" />
								{/if}
								<AvatarFallback class="text-[10px]">
									{#if Icon}
										<Icon class="size-3.5" aria-hidden="true" />
									{:else}
										{shareInitials(p.name)}
									{/if}
								</AvatarFallback>
							</Avatar>
						{/each}
						{#if hidden > 0}
							<Avatar class="size-6">
								<AvatarFallback class="text-[10px]">+{hidden}</AvatarFallback>
							</Avatar>
						{/if}
					</AvatarGroup>
				{:else}
					<Share2 />
				{/if}
				{label}
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end" class="w-[min(26rem,calc(100vw-2rem))] p-4">
		<div class="mb-3">
			<h2 class="text-sm font-semibold">{title}</h2>
			<p class="text-xs text-muted-foreground">{description}</p>
		</div>
		<SharePanel
			{shares}
			{owner}
			{levels}
			{defaultLevel}
			{canManage}
			{search}
			{onadd}
			{onchange}
			{onremove}
			{everyoneLabel}
			{placeholder}
			{searchLabel}
			{emptyResultText}
		/>
	</Popover.Content>
</Popover.Root>
