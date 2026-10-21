<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import TestMailCard from '../../_shared/TestMailCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let previewKey = $state(0);
</script>

<PageTitle title="E-Mail-Layout · Einstellungen" />

<Card.Root>
	<Card.Header>
		<Card.Title>Layout ausgehender E-Mails</Card.Title>
		<Card.Description>Kopf, Signatur und Fußzeile aller E-Mails des Systems.</Card.Description>
	</Card.Header>
	<Card.Content>
		<SettingsForm fields={data.fields} canEdit={data.canEdit} />
	</Card.Content>
</Card.Root>

<Card.Root>
	<Card.Header>
		<Card.Title>Vorschau</Card.Title>
		<Card.Description>
			So sehen ausgehende E-Mails aus. Speichere Änderungen zuerst, dann lade die Vorschau neu.
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		<iframe
			title="Vorschau des E-Mail-Layouts"
			src={`/admin/settings/mail-preview?v=${previewKey}`}
			class="h-[640px] w-full rounded-md border bg-muted/30"
			sandbox=""
		></iframe>
		<Button type="button" variant="outline" size="sm" onclick={() => (previewKey += 1)}>
			Vorschau neu laden
		</Button>
	</Card.Content>
</Card.Root>

{#if data.canEdit}
	<TestMailCard email={data.email} />
{/if}
