<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Allgemein · Einstellungen</title></svelte:head>

<Card.Root>
	<Card.Header>
		<Card.Title>System & Organisation</Card.Title>
		<Card.Description>
			Name des Systems sowie Name, Anschrift und Kontakt deiner Organisation (z. B. für Briefe und
			PDF-Dokumente).
		</Card.Description>
	</Card.Header>
	<Card.Content>
		<SettingsForm fields={data.fields} canEdit={data.canEdit} />
	</Card.Content>
</Card.Root>
