<script lang="ts">
	import type { Component } from 'svelte';
	import { PageTitle } from '$lib/components/layout';
	import type { ModulePageProps } from '$lib/sdk/types/module-ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const Page = $derived(data.component as Component<ModulePageProps>);
</script>

<PageTitle title={data.moduleName} />

<Page params={data.params} path={data.path} />
