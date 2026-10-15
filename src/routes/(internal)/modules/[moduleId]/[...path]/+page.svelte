<script lang="ts">
	import type { Component } from 'svelte';
	import type { ModulePageProps } from '$lib/sdk/types/module-ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	// Seiten ohne Props sind mit Component<ModulePageProps> kompatibel (Props werden ignoriert)
	const Page = $derived(data.component as Component<ModulePageProps>);
</script>

<svelte:head><title>{data.moduleName}</title></svelte:head>

<Page params={data.params} path={data.path} />
