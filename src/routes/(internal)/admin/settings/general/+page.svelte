<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import * as Card from '$lib/components/ui/card';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const filled = (key: string) => {
		const v = data.fields.find((f) => f.key === key)?.value;
		return typeof v === 'string' && v.trim() !== '';
	};
	/** Fehlen beide Links, zeigen Login und öffentliche Seiten keine Fußzeile */
	const missingLegal = $derived(
		[
			!filled('core.legal.imprintUrl') && 'Impressum',
			!filled('core.legal.privacyUrl') && 'Datenschutzerklärung'
		].filter(Boolean) as string[]
	);
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
		<Card.Content class="space-y-4">
			{#if missingLegal.length}
				<Alert variant="info">
					<AlertDescription>
						Noch ohne Link: {missingLegal.join(' und ')}. Die Anmeldeseite und öffentliche Seiten
						zeigen in der Fußzeile nur hinterlegte Links.
					</AlertDescription>
				</Alert>
			{/if}
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
