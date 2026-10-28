<script lang="ts">
	import type { Component } from 'svelte';
	import { page } from '$app/state';
	import type { ModulePageProps } from '$lib/sdk/types/module-ui';
	import LegalLinks from '$lib/components/layout/LegalLinks.svelte';
	import { PageTitle } from '$lib/components/layout';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const Page = $derived(data.component as Component<ModulePageProps>);
	const systemName = $derived((page.data as { systemName?: string }).systemName ?? '');
</script>

<svelte:head>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>
<PageTitle title={data.moduleName} />

<div class="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-8">
	{#if systemName}
		<p class="mb-6 text-sm font-medium text-muted-foreground">{systemName}</p>
	{/if}
	<div class="flex-1">
		<Page params={data.params} path={data.path} />
	</div>
	<LegalLinks
		privacyUrl={data.legal.privacyUrl}
		imprintUrl={data.legal.imprintUrl}
		notice
		class="mt-10 border-t pt-6"
	/>
</div>
