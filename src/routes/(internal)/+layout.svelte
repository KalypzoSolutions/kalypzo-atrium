<script lang="ts">
	import { untrack } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { AppSidebar, Topbar } from '$lib/components/layout';
	import ImpersonationBanner from '$lib/components/layout/ImpersonationBanner.svelte';
	import { t } from '$lib/i18n';
	import { refreshNavBadges, seedNavBadges } from '$lib/sdk/client/nav-badges.svelte';

	let { data, children } = $props();
	const fullBleed = $derived((page.data as { fullBleed?: boolean }).fullBleed === true);

	// Seitenleiste ein-/ausklappen: Startwert vom Server (Cookie), Wahl je Gerät im Cookie `sidebar`
	let sidebarCollapsed = $state(untrack(() => data.sidebarCollapsed));
	function toggleSidebar(collapsed: boolean) {
		sidebarCollapsed = collapsed;
		const secure = location.protocol === 'https:' ? '; secure' : '';
		document.cookie = `sidebar=${collapsed ? 'collapsed' : 'open'}; path=/; max-age=31536000; samesite=lax${secure}`;
	}

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
		const timer = setInterval(() => {
			if (!document.hidden) void refreshNavBadges();
		}, 60_000);
		return () => clearInterval(timer);
	});
</script>

<a href="#main" class="skip-link">{t('app.skipToContent')}</a>
<div class="flex min-h-screen">
	<AppSidebar
		systemName={data.systemName}
		logoUrl={data.logoUrl}
		permissions={data.permissions}
		navigation={data.navigation}
		collapsed={sidebarCollapsed}
		ontoggle={toggleSidebar}
	/>
	<div class="flex min-w-0 flex-1 flex-col">
		{#if data.impersonation}
			<ImpersonationBanner impersonation={data.impersonation} />
		{/if}
		{#if data.user}
			<Topbar
				user={data.user}
				systemName={data.systemName}
				logoUrl={data.logoUrl}
				permissions={data.permissions}
				navigation={data.navigation}
			/>
		{/if}
		{#if fullBleed}
			<!-- Vollflächige Modulseiten (`ModuleUi.fullBleedRoutes`): Höhe = Fenster minus Kopfzeile -->
			<main
				id="main"
				tabindex="-1"
				class="flex h-[calc(100dvh-3.5rem-var(--impersonation-h,0px))] min-h-0 flex-col outline-none"
			>
				{@render children()}
			</main>
		{:else}
			<main id="main" tabindex="-1" class="flex-1 p-4 outline-none sm:p-6 lg:p-8">
				<div class="mx-auto max-w-6xl">
					{@render children()}
				</div>
			</main>
		{/if}
	</div>
</div>
