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

	let {
		permissions,
		navigation,
		onnavigate
	}: {
		permissions: string[];
		navigation: ModuleNavEntry[];
		onnavigate?: () => void;
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

{#snippet linkItem(item: Link, nested = false)}
	{@const Icon = iconFor(item.icon)}
	{@const active = item.href === activeHref}
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
		{/if}
	</a>
{/snippet}

{#snippet groupButton(id: string, label: string, icon: string, open: boolean, active = false)}
	{@const Icon = iconFor(icon)}
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
{/snippet}

<nav aria-label="Hauptnavigation" class="flex flex-col gap-0.5 p-2">
	{#each entries as entry (entry.kind === 'link' ? entry.link.href : entry.id)}
		{#if entry.kind === 'link'}
			{@render linkItem(entry.link)}
		{:else}
			{@const open = isOpen(entry.id, entry.items)}
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
		{@const open = isOpen(ADMIN_ID, adminLinks)}
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
