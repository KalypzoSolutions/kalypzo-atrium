<script lang="ts">
	import '../app.css';
	import '$lib/zod-locale';
	import { onMount } from 'svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { theme } from '$lib/theme.svelte';
	import { initServiceWorkerNavigation } from '$lib/sdk/client/sw-navigation';

	let { data, children } = $props();

	onMount(() => {
		theme.init();
		// Klick auf eine Push-Benachrichtigung: Zielseite im offenen App-Fenster öffnen
		return initServiceWorkerNavigation();
	});

	$effect(() => {
		document.documentElement.style.setProperty('--accent-color', data.accentColor);
		document.documentElement.dataset.density = data.density;
	});
</script>

<svelte:head>
	<title>{data.systemName}</title>
</svelte:head>

{@render children()}
<Toaster richColors position="top-right" />
