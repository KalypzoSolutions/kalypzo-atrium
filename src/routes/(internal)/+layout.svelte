<script lang="ts">
	import { untrack } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { AppSidebar, Topbar } from '$lib/components/layout';
	import { refreshNavBadges, seedNavBadges } from '$lib/sdk/client/nav-badges.svelte';

	let { data, children } = $props();

	// Zähler der Seitenleiste: Startwert aus dem Layout, danach nach jeder Navigation und jede Minute
	// (nur im sichtbaren Tab) aktualisieren
	$effect(() => {
		const initial = data.navBadges;
		untrack(() => seedNavBadges(initial));
	});
	let firstNavigation = true;
	afterNavigate(() => {
		if (firstNavigation) {
			firstNavigation = false;
			return;
		}
		if (data.user) void refreshNavBadges();
	});
	$effect(() => {
		if (!data.user) return;
		const t = setInterval(() => {
			if (!document.hidden) void refreshNavBadges();
		}, 60_000);
		return () => clearInterval(t);
	});
</script>

<a href="#main" class="skip-link">Zum Inhalt springen</a>
<div class="flex min-h-screen">
	<AppSidebar
		systemName={data.systemName}
		permissions={data.permissions}
		navigation={data.navigation}
	/>
	<div class="flex min-w-0 flex-1 flex-col">
		{#if data.user}
			<Topbar
				user={data.user}
				systemName={data.systemName}
				permissions={data.permissions}
				navigation={data.navigation}
			/>
		{/if}
		<main id="main" tabindex="-1" class="flex-1 p-4 outline-none sm:p-6 lg:p-8">
			<div class="mx-auto max-w-6xl">
				{@render children()}
			</div>
		</main>
	</div>
</div>
