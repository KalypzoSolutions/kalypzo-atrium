<script lang="ts">
	import Share2 from '@lucide/svelte/icons/share-2';
	import { Avatar, AvatarFallback, AvatarGroup } from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import SharePanel from './SharePanel.svelte';
	import type { ShareCandidate, ShareEntry, ShareLevel, ShareOwner } from './share-types';

	/**
	 * Freigabe-Menue fuer Seitenkoepfe: Button mit Avatar-Stapel der Personen mit Zugriff; ein
	 * Klick oeffnet ein Popover (rechtsbuendig) mit `SharePanel`. Gedacht fuer die Aktionsleiste
	 * neben „Bearbeiten“/„Loeschen“.
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
		maxAvatars = 3
	}: {
		shares: ShareEntry[];
		owner?: ShareOwner;
		levels: ShareLevel[];
		defaultLevel?: string;
		canManage?: boolean;
		search: (query: string) => Promise<ShareCandidate[]>;
		onadd: (user: ShareCandidate, level: string) => Promise<void>;
		onchange: (userId: string, level: string) => Promise<void>;
		onremove: (userId: string) => Promise<void>;
		title?: string;
		description?: string;
		label?: string;
		maxAvatars?: number;
	} = $props();

	let open = $state(false);

	function initials(name: string): string {
		return (
			name
				.split(/\s+/)
				.filter(Boolean)
				.slice(0, 2)
				.map((p) => p[0]!.toUpperCase())
				.join('') || '?'
		);
	}

	const people = $derived([
		...(owner ? [{ key: 'owner', name: owner.name }] : []),
		...shares.map((s) => ({ key: s.userId, name: s.name }))
	]);
	const visible = $derived(people.slice(0, maxAvatars));
	const hidden = $derived(Math.max(0, people.length - visible.length));
	const summary = $derived(
		people.length <= 1
			? 'Nur du hast Zugriff'
			: `${people.length} Personen haben Zugriff: ${people.map((p) => p.name).join(', ')}`
	);
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" class="gap-2" aria-label="{label}: {summary}">
				{#if people.length > 0}
					<AvatarGroup class="-space-x-1.5">
						{#each visible as p (p.key)}
							<Avatar class="size-6">
								<AvatarFallback class="text-[10px]">{initials(p.name)}</AvatarFallback>
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
		/>
	</Popover.Content>
</Popover.Root>
