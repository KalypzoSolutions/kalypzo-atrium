<script lang="ts">
	import SidebarNav from './SidebarNav.svelte';
	import type { ModuleNavEntry } from './nav';

	let {
		systemName,
		permissions,
		navigation
	}: {
		systemName: string;
		permissions: string[];
		navigation: ModuleNavEntry[];
	} = $props();
</script>

<!-- Fest am Bildschirm (sticky, volle Höhe): die Navigation scrollt unabhängig vom Seiteninhalt -->
<aside
	class="app-glass hidden w-56 shrink-0 border-r bg-sidebar-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col"
>
	<div class="flex h-14 shrink-0 items-center border-b px-4">
		<a href="/dashboard" class="truncate text-base font-semibold">{systemName}</a>
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<SidebarNav {permissions} {navigation} />
	</div>
</aside>
