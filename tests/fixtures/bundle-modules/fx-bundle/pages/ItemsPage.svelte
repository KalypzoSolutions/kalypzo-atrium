<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { PageHeader } from '$lib/components/layout';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { apiFetch } from '$lib/sdk/client';
	import { t } from '$lib/sdk/i18n';

	let items = $state<string[]>([]);
	let greeting = $state('');
	let mounted = $state(false);

	async function reload() {
		const res = await apiFetch<{ greeting: string; items: string[] }>('/modules/fx-bundle/items');
		greeting = res.greeting;
		items = res.items;
	}

	async function add() {
		const name = `Eintrag ${items.length + 1}`;
		await apiFetch('/modules/fx-bundle/items', {
			method: 'POST',
			body: JSON.stringify({ name })
		});
		toast.success(t('fx-bundle.added', { name }));
		await reload();
	}

	onMount(() => {
		mounted = true;
		void reload();
	});
</script>

<div class="space-y-6">
	<PageHeader title={t('fx-bundle.title')} description={t('fx-bundle.greeting')} />
	<!-- Eigene Tailwind-Klasse nur hier: beweist, dass die Klassen des Bundles im CSS landen -->
	<Card.Root class="min-h-[13.37rem]" data-testid="fx-bundle-page" data-mounted={mounted}>
		<Card.Content class="space-y-3">
			<!-- Mischfall: `p-4` hat auch der Core, `sm:p-[1.37rem]` nur das Modul – die Variante muss ab `sm` gewinnen
			     (getrennte Teil-Stylesheets ließen sie gegen die Basis-Klasse des Core verlieren) -->
			<p data-testid="fx-bundle-greeting" class="p-4 sm:p-[1.37rem]">{greeting}</p>
			<Button onclick={add} data-testid="fx-bundle-add">{t('fx-bundle.add')}</Button>
			<ul data-testid="fx-bundle-items">
				{#each items as item (item)}
					<li>{item}</li>
				{/each}
			</ul>
		</Card.Content>
	</Card.Root>
</div>
