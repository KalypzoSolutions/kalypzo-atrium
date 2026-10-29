<script lang="ts">
	import { page } from '$app/state';
	import { cn } from '$lib/utils';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import {
		ADMIN_GROUP,
		PRIMARY_NAV,
		buildAdminNav,
		canSeeNavItem,
		isActive,
		type ModuleNavEntry
	} from './nav';
	import { iconFor } from './icons';
	import CountBadge from './CountBadge.svelte';
	import { navBadges } from '$lib/sdk/client/nav-badges.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	let {
		permissions,
		navigation,
		onnavigate,
		collapsed = false,
		onexpand
	}: {
		permissions: string[];
		navigation: ModuleNavEntry[];
		onnavigate?: () => void;
		/** Schmale Symbolleiste (Desktop): nur Icons, Name als Tooltip, Gruppen zugeklappt */
		collapsed?: boolean;
		/** Eingeklappt: Klick auf eine Gruppe klappt die Leiste aus */
		onexpand?: () => void;
	} = $props();

	interface Link {
		label: string;
		href: string;
		icon: string;
		/** Kleine Zusatzzeile unter dem Label */
		hint?: string;
		/** Nur bei exakt gleichem Pfad aktiv */
		exact?: boolean;
	}
	type Group = { kind: 'group'; id: string; label: string; icon: string; items: Link[] };
	type Entry = { kind: 'link'; link: Link } | Group;

	const ADMIN_ID = 'core:admin';

	/** Zähler je Pfad (z. B. ungelesene Mails): beim SSR aus dem Layout, danach aus dem Store */
	const badgeCounts = $derived<Record<string, number>>(
		navBadges.seeded
			? navBadges.counts
			: ((page.data.navBadges as Record<string, number> | undefined) ?? {})
	);

	const primary = $derived(PRIMARY_NAV.filter((i) => canSeeNavItem(permissions, i)));

	/**
	 * Modul-Einträge: gleiche `group` werden zu einer Gruppe – auch über Module hinweg (z. B. „Stamm“ mit
	 * Mitgliedern und Nachrichten); Reihenfolge bleibt erhalten.
	 */
	const moduleEntries = $derived.by(() => {
		const out: Entry[] = [];
		const groups = new Map<string, Group>();
		for (const n of navigation) {
			if (n.admin) continue;
			const link = { label: n.label, href: n.path, icon: n.icon };
			if (!n.group) {
				out.push({ kind: 'link', link });
				continue;
			}
			const id = `group:${n.group}`;
			let g = groups.get(id);
			if (!g) {
				g = { kind: 'group', id, label: n.group, icon: n.groupIcon ?? 'folder', items: [] };
				groups.set(id, g);
				out.push(g);
			} else if (n.groupIcon && g.icon === 'folder') {
				g.icon = n.groupIcon;
			}
			g.items.push(link);
		}
		return out;
	});

	/** Verwaltung: Übersicht + Abschnitte aus `admin-registry.ts`; `null` ohne sichtbaren Eintrag. */
	const adminNav = $derived(buildAdminNav(permissions, navigation));

	const entries = $derived<Entry[]>([
		...primary.map((i): Entry => ({ kind: 'link', link: i })),
		...moduleEntries
	]);

	const adminLinks = $derived<Link[]>(
		adminNav ? [adminNav.home, ...adminNav.sections.flatMap((s) => s.items)] : []
	);

	/**
	 * Nur der genaueste passende Eintrag ist aktiv (z. B. `/modules/treasury/settings` statt `/modules`;
	 * Reiter wie `/admin/settings/mail` markieren `/admin/settings`). `/admin` selbst nur exakt.
	 */
	const activeHref = $derived.by(() => {
		const path = page.url.pathname;
		const links = [
			...entries.flatMap((e) => (e.kind === 'link' ? [e.link] : e.items)),
			...adminLinks
		];
		return (
			links
				.filter((l) => (l.exact ? path === l.href : isActive(path, l.href)))
				.map((l) => l.href)
				.sort((a, b) => b.length - a.length)[0] ?? null
		);
	});

	// Manuell umgeschaltete Gruppen; ohne Eintrag ist eine Gruppe offen, wenn sie die aktive Seite enthält.
	// Ausnahme Administration: nach dem Laden immer zu (nichts wird gespeichert).
	let toggled = $state<Record<string, boolean>>({});
	const containsActive = (items: Link[]) => items.some((i) => i.href === activeHref);
	const isOpen = (id: string, items: Link[]) =>
		toggled[id] ?? (id === ADMIN_ID ? false : containsActive(items));

	const linkClass =
		'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
</script>

{#snippet railTip(label: string, trigger: import('svelte').Snippet<[Record<string, unknown>]>)}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				{@render trigger(props)}
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="right" sideOffset={8}>{label}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

{#snippet linkItem(item: Link, nested = false)}
	{@const Icon = iconFor(item.icon)}
	{@const active = item.href === activeHref}
	{#if collapsed}
		{@const count = badgeCounts[item.href] ?? 0}
		{#snippet railLink(props: Record<string, unknown>)}
			<a
				{...props}
				href={item.href}
				onclick={(e) => {
					(props.onclick as ((e: MouseEvent) => void) | undefined)?.(e);
					onnavigate?.();
				}}
				aria-current={active ? 'page' : undefined}
				class={cn(
					linkClass,
					'relative size-9 justify-center px-0',
					active && 'bg-accent text-accent-foreground'
				)}
			>
				<Icon class="size-4 shrink-0" aria-hidden="true" />
				<span class="sr-only">{item.label}{count ? ` (${count})` : ''}</span>
				{#if count}
					<span class="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" aria-hidden="true"
					></span>
				{/if}
			</a>
		{/snippet}
		{@render railTip(item.label, railLink)}
	{:else}
		<a
			href={item.href}
			onclick={onnavigate}
			aria-current={active ? 'page' : undefined}
			class={cn(linkClass, nested && 'pl-5', active && 'bg-accent text-accent-foreground')}
		>
			<Icon class="size-4 shrink-0" aria-hidden="true" />
			<span class="min-w-0 truncate">{item.label}</span>
			{#if item.hint}
				<span class="ml-auto shrink-0 text-xs font-normal text-muted-foreground">{item.hint}</span>
			{:else if badgeCounts[item.href]}
				<CountBadge count={badgeCounts[item.href] ?? 0} class="ml-auto" />
			{/if}
		</a>
	{/if}
{/snippet}

{#snippet groupButton(id: string, label: string, icon: string, open: boolean, active = false)}
	{@const Icon = iconFor(icon)}
	{#if collapsed}
		{#snippet railGroup(props: Record<string, unknown>)}
			<button
				{...props}
				type="button"
				onclick={() => {
					toggled[id] = true;
					onexpand?.();
				}}
				class={cn(
					linkClass,
					'size-9 justify-center px-0',
					active && 'bg-accent text-accent-foreground'
				)}
			>
				<Icon class="size-4 shrink-0" aria-hidden="true" />
				<span class="sr-only">{label} (Seitenleiste ausklappen)</span>
			</button>
		{/snippet}
		{@render railTip(label, railGroup)}
	{:else}
		<!-- `active`: zugeklappte Gruppe enthält die aktuelle Seite -->
		<button
			type="button"
			aria-expanded={open}
			aria-controls={`nav-${id}`}
			onclick={() => (toggled[id] = !open)}
			class={cn(linkClass, 'w-full justify-between', active && 'bg-accent text-accent-foreground')}
		>
			<span class="flex items-center gap-2.5">
				<Icon class="size-4 shrink-0" aria-hidden="true" />
				{label}
			</span>
			<ChevronDown
				class={cn('size-3.5 transition-transform', !open && '-rotate-90')}
				aria-hidden="true"
			/>
		</button>
	{/if}
{/snippet}

<Tooltip.Provider delayDuration={200}>
	<nav
		aria-label="Hauptnavigation"
		class={cn('flex flex-col gap-0.5 p-2', collapsed && 'items-center')}
	>
		{#each entries as entry (entry.kind === 'link' ? entry.link.href : entry.id)}
			{#if entry.kind === 'link'}
				{@render linkItem(entry.link)}
			{:else}
				{@const open = !collapsed && isOpen(entry.id, entry.items)}
				{@render groupButton(
					entry.id,
					entry.label,
					entry.icon,
					open,
					!open && containsActive(entry.items)
				)}
				{#if open}
					<div id={`nav-${entry.id}`} class="flex flex-col gap-0.5">
						{#each entry.items as item (item.href)}
							{@render linkItem(item, true)}
						{/each}
					</div>
				{/if}
			{/if}
		{/each}

		{#if adminNav}
			{@const open = !collapsed && isOpen(ADMIN_ID, adminLinks)}
			{@render groupButton(
				ADMIN_ID,
				ADMIN_GROUP.label,
				ADMIN_GROUP.icon,
				open,
				!open && containsActive(adminLinks)
			)}
			{#if open}
				<div id={`nav-${ADMIN_ID}`} class="flex flex-col gap-0.5">
					{@render linkItem(adminNav.home, true)}
					{#each adminNav.sections as section (section.id)}
						{@const headingId = `nav-admin-${section.id}`}
						<!-- Überschrift nur sichtbar, wenn sie mehr sagt als der einzige Eintrag („Einstellungen“ › „Einstellungen“) -->
						{@const redundant =
							section.items.length === 1 && section.items[0]?.label === section.label}
						<div role="group" aria-labelledby={headingId} class="mt-2 flex flex-col gap-0.5">
							<div
								id={headingId}
								class={cn(
									'pr-2.5 pb-0.5 pl-5 text-xs font-medium tracking-wide text-muted-foreground/80 uppercase',
									redundant && 'sr-only'
								)}
							>
								{section.label}
							</div>
							{#each section.items as item (item.href)}
								{@render linkItem(item, true)}
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</nav>
</Tooltip.Provider>
