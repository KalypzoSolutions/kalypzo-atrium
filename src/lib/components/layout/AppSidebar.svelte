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

<aside class="hidden w-56 shrink-0 border-r bg-sidebar lg:flex lg:flex-col">
	<div class="flex h-14 items-center border-b px-4">
		<a href="/dashboard" class="truncate text-base font-semibold">{systemName}</a>
	</div>
	<div class="flex-1 overflow-y-auto">
		<SidebarNav {permissions} {navigation} />
	</div>
</aside>
