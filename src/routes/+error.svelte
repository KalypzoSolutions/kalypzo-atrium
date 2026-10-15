<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
</script>

<svelte:head><title>Fehler {page.status}</title></svelte:head>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
	<p class="text-5xl font-semibold text-muted-foreground">{page.status}</p>
	<h1 class="text-xl font-semibold">
		{page.status === 404 ? 'Seite nicht gefunden' : 'Es ist ein Fehler aufgetreten'}
	</h1>
	<p class="max-w-md text-sm text-muted-foreground">{page.error?.message}</p>
	{#if page.error?.requestId}
		<p class="text-xs text-muted-foreground">Referenz: {page.error.requestId}</p>
	{/if}
	<Button href="/dashboard">Zum Dashboard</Button>
</main>
