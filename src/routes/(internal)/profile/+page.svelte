<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { PageHeader } from '$lib/components/layout';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as Tabs from '$lib/components/ui/tabs';
	import AccountTab from './_components/AccountTab.svelte';
	import AppearanceTab from './_components/AppearanceTab.svelte';
	import SecurityTab from './_components/SecurityTab.svelte';
	import type { ProfileData } from './_components/types';

	let { data } = $props();

	const d = $derived(data as unknown as ProfileData);
	const sections = $derived(data.sections);

	const tabs = $derived([
		{ value: 'account', label: 'Konto' },
		{ value: 'security', label: 'Sicherheit' },
		{ value: 'appearance', label: 'Darstellung' },
		...sections.map((s) => ({ value: s.key, label: s.title }))
	]);

	const requested = $derived(page.url.searchParams.get('tab') ?? 'account');
	const tab = $derived(tabs.some((t) => t.value === requested) ? requested : 'account');

	// Modul-Komponenten je Schlüssel nur einmal laden: ein `invalidateAll` liefert neue Lader-Funktionen,
	// ein neues Promise würde den Abschnitt neu aufbauen und ungespeicherte Entwürfe verwerfen.
	const loaded = new Map<string, ReturnType<(typeof sections)[number]['component']>>();
	function sectionComponent(s: (typeof sections)[number]) {
		let p = loaded.get(s.key);
		if (!p) {
			p = s.component();
			loaded.set(s.key, p);
		}
		return p;
	}

	// Rückkehr vom Bestätigungslink der E-Mail-Änderung (`?emailChanged=1`)
	$effect(() => {
		if (page.url.searchParams.get('emailChanged') !== '1') return;
		toast.success('E-Mail-Adresse geändert.');
		const url = new URL(page.url);
		url.searchParams.delete('emailChanged');
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	});

	function setTab(value: string) {
		const url = new URL(page.url);
		if (value === 'account') url.searchParams.delete('tab');
		else url.searchParams.set('tab', value);
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}
</script>

<svelte:head><title>Profil - {data.systemName}</title></svelte:head>

<PageHeader title="Profil" description="Konto, Sicherheit und persönliche Einstellungen." />

<Tabs.Root value={tab} onValueChange={setTab}>
	<Tabs.List variant="line" class="mb-4 h-auto">
		{#each tabs as t (t.value)}
			<Tabs.Trigger value={t.value}>{t.label}</Tabs.Trigger>
		{/each}
	</Tabs.List>

	<Tabs.Content value="account"><AccountTab data={d} /></Tabs.Content>
	<Tabs.Content value="security"><SecurityTab data={d} /></Tabs.Content>
	<Tabs.Content value="appearance"><AppearanceTab data={d} /></Tabs.Content>

	{#each sections as s (s.key)}
		<Tabs.Content value={s.key}>
			{#await sectionComponent(s)}
				<Skeleton class="h-40 w-full" />
			{:then mod}
				{@const Section = mod.default}
				<Section userId={data.profile.id} />
			{:catch}
				<p class="text-sm text-destructive" role="alert">
					Dieser Bereich konnte nicht geladen werden. Bitte lade die Seite neu.
				</p>
			{/await}
		</Tabs.Content>
	{/each}
</Tabs.Root>
