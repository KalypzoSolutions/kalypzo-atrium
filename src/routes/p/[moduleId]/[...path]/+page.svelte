<script lang="ts">
	import type { Component } from 'svelte';
	import { page } from '$app/state';
	import type { ModulePageProps } from '$lib/sdk/types/module-ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const Page = $derived(data.component as Component<ModulePageProps>);
	const systemName = $derived((page.data as { systemName?: string }).systemName ?? '');
</script>

<svelte:head>
	<meta name="robots" content="noindex,nofollow" />
	<title>{data.moduleName}</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-8">
	{#if systemName}
		<p class="mb-6 text-sm font-medium text-muted-foreground">{systemName}</p>
	{/if}
	<Page params={data.params} path={data.path} />
</div>
