<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LinkTabs, PageHeader } from '$lib/components/layout';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<PageHeader
	title="Einstellungen"
	description="Organisation, Design, E-Mail, Speicher, KI, PDF und Einstellungen der Module."
/>

<div class="space-y-6">
	<LinkTabs tabs={data.settingsTabs} label="Einstellungsbereiche" />
	{@render children()}
</div>
