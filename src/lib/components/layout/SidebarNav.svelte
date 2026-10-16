<script lang="ts">
	import { page } from '$app/state';
	import { cn } from '$lib/utils';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import {
		ADMIN_GROUP,
		ADMIN_NAV,
		PRIMARY_NAV,
		hasPermission,
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
	}
	type Entry =
		| { kind: 'link'; link: Link }
		| { kind: 'group'; id: string; label: string; icon: string; items: Link[] };

	const primary = $derived(PRIMARY_NAV.filter((i) => hasPermission(permissions, i.permission)));

	/** Modul-Eintraege: gleiche `group` (je Modul) werden zu einer Gruppe, Reihenfolge bleibt erhalten. */
	const moduleEntries = $derived.by(() => {
		const out: Entry[] = [];
		const groups = new Map<string, Extract<Entry, { kind: 'group' }>>();
		for (const n of navigation) {
			if (n.admin) continue;
			const link = { label: n.label, href: n.path, icon: n.icon };
			if (!n.group) {
				out.push({ kind: 'link', link });
				continue;
			}
			const id = `${n.moduleId}:${n.group}`;
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

	const adminGroup = $derived.by((): Entry | null => {
		const items = [
			...ADMIN_NAV.filter((i) => hasPermission(permissions, i.permission)).map((i) => ({
				label: i.label,
				href: i.href,
				icon: i.icon
			})),
			// Modul-Eintraege fuer die Verwaltung (z. B. Kassen-Einstellungen)
			...navigation
				.filter((n) => n.admin)
				.map((n) => ({ label: n.label, href: n.path, icon: n.icon }))
		];
		return items.length
			? { kind: 'group', id: 'core:admin', label: ADMIN_GROUP.label, icon: ADMIN_GROUP.icon, items }
			: null;
	});

	const entries = $derived<Entry[]>([
		...primary.map((i): Entry => ({ kind: 'link', link: i })),
		...moduleEntries,
		...(adminGroup ? [adminGroup] : [])
	]);

	/** Nur der genaueste passende Eintrag ist aktiv (z. B. `/modules/treasury/settings` statt `/modules`). */
	const activeHref = $derived.by(() => {
		const hrefs = entries.flatMap((e) =>
			e.kind === 'link' ? [e.link.href] : e.items.map((i) => i.href)
		);
		return (
			hrefs.filter((h) => isActive(page.url.pathname, h)).sort((a, b) => b.length - a.length)[0] ??
			null
		);
	});

	// Manuell umgeschaltete Gruppen; ohne Eintrag ist eine Gruppe offen, wenn sie die aktive Seite enthaelt.
	let toggled = $state<Record<string, boolean>>({});
	const isOpen = (g: Extract<Entry, { kind: 'group' }>) =>
		toggled[g.id] ?? g.items.some((i) => i.href === activeHref);

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
		{item.label}
	</a>
{/snippet}

<nav aria-label="Hauptnavigation" class="flex flex-col gap-0.5 p-2">
	{#each entries as entry (entry.kind === 'link' ? entry.link.href : entry.id)}
		{#if entry.kind === 'link'}
			{@render linkItem(entry.link)}
		{:else}
			{@const Icon = iconFor(entry.icon)}
			{@const open = isOpen(entry)}
			<button
				type="button"
				aria-expanded={open}
				aria-controls={`nav-${entry.id}`}
				onclick={() => (toggled[entry.id] = !open)}
				class={cn(linkClass, 'w-full justify-between')}
			>
				<span class="flex items-center gap-2.5">
					<Icon class="size-4 shrink-0" aria-hidden="true" />
					{entry.label}
				</span>
				<ChevronDown
					class={cn('size-3.5 transition-transform', !open && '-rotate-90')}
					aria-hidden="true"
				/>
			</button>
			{#if open}
				<div id={`nav-${entry.id}`} class="flex flex-col gap-0.5">
					{#each entry.items as item (item.href)}
						{@render linkItem(item, true)}
					{/each}
				</div>
			{/if}
		{/if}
	{/each}
</nav>
