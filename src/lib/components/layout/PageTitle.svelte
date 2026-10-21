<script lang="ts">
	import { page } from '$app/state';
	import { documentTitle } from './page-title';

	/** Setzt `<title>` im Format „Seite – Systemname“ (Systemname aus den Layout-Daten). */
	let { title }: { title?: string | null } = $props();

	const systemName = $derived(
		typeof page.data?.systemName === 'string' ? (page.data.systemName as string) : null
	);
</script>

<svelte:head><title>{documentTitle(title, systemName)}</title></svelte:head>
