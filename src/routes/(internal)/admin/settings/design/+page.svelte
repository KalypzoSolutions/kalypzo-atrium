<script lang="ts">
	import { enhance } from '$app/forms';
	import { FileField } from '$lib/components/layout';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Label } from '$lib/components/ui/label';
	import { submitHandler } from '../../_shared/form-utils';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let logoBusy = $state(false);
	const logoHandler = submitHandler({ busy: (b) => (logoBusy = b) });
</script>

<svelte:head><title>Design · Einstellungen</title></svelte:head>

<Card.Root>
	<Card.Header>
		<Card.Title>Erscheinungsbild</Card.Title>
		<Card.Description>Akzentfarbe und Logo für Oberfläche und Dokumente.</Card.Description>
	</Card.Header>
	<Card.Content>
		<SettingsForm fields={data.fields} canEdit={data.canEdit} />
	</Card.Content>
</Card.Root>

{#if data.canUploadLogo}
	<Card.Root>
		<Card.Header>
			<Card.Title>Logo hochladen</Card.Title>
			<Card.Description>
				PNG, JPEG oder WebP, maximal 2 MB. Das Logo erscheint in PDF-Dokumenten.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/uploadLogo"
				enctype="multipart/form-data"
				class="flex flex-wrap items-end gap-3"
				use:enhance={logoHandler}
			>
				<div class="space-y-1.5">
					<Label for="logo">Datei</Label>
					<FileField id="logo" name="logo" accept="image/png,image/jpeg,image/webp" required />
				</div>
				<Button type="submit" disabled={logoBusy}>{logoBusy ? 'Lädt hoch …' : 'Hochladen'}</Button>
			</form>
		</Card.Content>
	</Card.Root>
{:else if data.canEdit}
	<p class="text-xs text-muted-foreground">
		Zum Hochladen eines Logos brauchst du zusätzlich Schreibrechte für den Speicher.
	</p>
{/if}
