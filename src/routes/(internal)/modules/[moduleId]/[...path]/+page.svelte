<script lang="ts">
	import type { Component } from 'svelte';
	import { page } from '$app/state';
	import { PageTitle, navLabelFor } from '$lib/components/layout';
	import type { ModulePageProps } from '$lib/sdk/types/module-ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	// Seiten ohne Props sind mit Component<ModulePageProps> kompatibel (Props werden ignoriert)
	const Page = $derived(data.component as Component<ModulePageProps>);
	// Zentraler Titel „Seite – Systemname“ aus dem Navigationseintrag; Modulseiten dürfen ihn mit
	// eigenem `PageTitle` (z. B. Name des geöffneten Datensatzes) überschreiben.
	const navTitle = $derived(
		navLabelFor(
			(data.navigation ?? []).filter((n) => n.moduleId === data.moduleId),
			page.url.pathname
		) ?? data.moduleName
	);
</script>

<PageTitle title={navTitle} />

<Page params={data.params} path={data.path} />
