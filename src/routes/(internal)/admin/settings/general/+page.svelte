<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import * as Card from '$lib/components/ui/card';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title="Allgemein · Einstellungen" />

<div class="space-y-6">
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

	<Card.Root>
		<Card.Header>
			<Card.Title>Aufbewahrungsfristen</Card.Title>
			<Card.Description>
				Protokolle mit IP-Adressen werden nur so lange aufbewahrt wie hier eingestellt. Der tägliche
				Job „core.housekeeping“ löscht ältere Einträge bzw. entfernt die IP-Adressen. Die Fristen
				legt der Verein fest (Verarbeitungsverzeichnis).
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<SettingsForm fields={data.retentionFields} canEdit={data.canEdit} />
		</Card.Content>
	</Card.Root>
</div>
