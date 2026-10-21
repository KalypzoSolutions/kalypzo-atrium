<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import * as Card from '$lib/components/ui/card';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import TestMailCard from '../../_shared/TestMailCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title="E-Mail-Versand · Einstellungen" />

<Card.Root>
	<Card.Header>
		<Card.Title>SMTP-Server</Card.Title>
		<Card.Description>
			Über diesen Server verschickt das System alle E-Mails. Das Passwort wird verschlüsselt
			gespeichert und nie an den Browser übertragen.
		</Card.Description>
	</Card.Header>
	<Card.Content>
		<SettingsForm fields={data.fields} canEdit={data.canEdit} />
	</Card.Content>
</Card.Root>

{#if data.canEdit}
	<TestMailCard email={data.email} />
{/if}
