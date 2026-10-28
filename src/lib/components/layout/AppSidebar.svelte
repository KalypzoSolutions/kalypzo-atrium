<script lang="ts">
	import SidebarNav from './SidebarNav.svelte';
	import type { ModuleNavEntry } from './nav';

	let {
		systemName,
		logoUrl = null,
		permissions,
		navigation
	}: {
		systemName: string;
		/** Logo aus den Design-Einstellungen (`null` = nur Name) */
		logoUrl?: string | null;
		permissions: string[];
		navigation: ModuleNavEntry[];
	} = $props();
</script>

<!-- Fest am Bildschirm (sticky, volle Höhe): die Navigation scrollt unabhängig vom Seiteninhalt -->
<aside
	class="app-glass hidden w-56 shrink-0 border-r bg-sidebar-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col"
>
	<div class="flex h-14 shrink-0 items-center border-b px-4">
		<a href="/dashboard" class="flex min-w-0 items-center gap-2.5 text-base font-semibold">
			{#if logoUrl}
				<img src={logoUrl} alt="" class="size-8 shrink-0 object-contain" />
			{/if}
			<span class="truncate">{systemName}</span>
		</a>
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<SidebarNav {permissions} {navigation} />
	</div>
</aside>
