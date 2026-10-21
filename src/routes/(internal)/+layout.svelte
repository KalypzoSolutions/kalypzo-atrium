<script lang="ts">
	import { AppSidebar, Topbar } from '$lib/components/layout';

	let { data, children } = $props();
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
