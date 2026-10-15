<script lang="ts">
	import { AppSidebar, Topbar } from '$lib/components/layout';

	let { data, children } = $props();
</script>

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
		<main id="main" class="flex-1 p-4 sm:p-6 lg:p-8">
			<div class="mx-auto max-w-6xl">
				{@render children()}
			</div>
		</main>
	</div>
</div>
