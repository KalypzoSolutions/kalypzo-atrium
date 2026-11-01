<script lang="ts">
	import { t } from '$lib/i18n';
	import PanelLeft from '@lucide/svelte/icons/panel-left';
	import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
	import { cn } from '$lib/utils';
	import SidebarNav from './SidebarNav.svelte';
	import type { ModuleNavEntry } from './nav';

	let {
		systemName,
		logoUrl = null,
		permissions,
		navigation,
		collapsed = false,
		ontoggle
	}: {
		systemName: string;
		/** Logo aus den Design-Einstellungen (`null` = nur Name) */
		logoUrl?: string | null;
		permissions: string[];
		navigation: ModuleNavEntry[];
		/** Eingeklappt: schmale Leiste nur mit Symbolen (gemerkt je Gerät, Cookie `sidebar`) */
		collapsed?: boolean;
		/** Ein-/Ausklappen; `true` = einklappen */
		ontoggle?: (collapsed: boolean) => void;
	} = $props();
</script>

<!-- Fest am Bildschirm (sticky, volle Höhe): die Navigation scrollt unabhängig vom Seiteninhalt -->
<aside
	class={cn(
		'app-glass hidden shrink-0 border-r bg-sidebar-surface transition-[width] duration-200 motion-reduce:transition-none lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col',
		collapsed ? 'w-14' : 'w-56'
	)}
	data-collapsed={collapsed ? 'true' : undefined}
	data-testid="app-sidebar"
>
	<div
		class={cn('flex h-14 shrink-0 items-center border-b', collapsed ? 'justify-center' : 'px-4')}
	>
		<a
			href="/dashboard"
			class="flex min-w-0 items-center gap-2.5 text-base font-semibold"
			aria-label={collapsed ? t('sidebar.homeLabel', { name: systemName }) : undefined}
		>
			{#if logoUrl}
				<img src={logoUrl} alt="" class="size-8 shrink-0 object-contain" />
			{:else if collapsed}
				<PanelLeft class="size-5 text-muted-foreground" aria-hidden="true" />
			{/if}
			{#if !collapsed}<span class="truncate">{systemName}</span>{/if}
		</a>
	</div>
	<div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
		<SidebarNav {permissions} {navigation} {collapsed} onexpand={() => ontoggle?.(false)} />
	</div>
	<div class={cn('shrink-0 border-t p-2', collapsed && 'flex justify-center')}>
		<button
			type="button"
			onclick={() => ontoggle?.(!collapsed)}
			aria-expanded={!collapsed}
			aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
			title={collapsed ? t('sidebar.expand') : undefined}
			data-testid="sidebar-toggle"
			class={cn(
				'flex items-center gap-2.5 rounded-md py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
				collapsed ? 'size-9 justify-center' : 'w-full px-2.5'
			)}
		>
			{#if collapsed}
				<PanelLeftOpen class="size-4 shrink-0" aria-hidden="true" />
			{:else}
				<PanelLeftClose class="size-4 shrink-0" aria-hidden="true" />
				{t('sidebar.collapseShort')}
			{/if}
		</button>
	</div>
</aside>
