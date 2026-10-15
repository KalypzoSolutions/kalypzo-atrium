<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Label } from '$lib/components/ui/label';
	import { SelectField } from '$lib/components/ui/select-field';
	import TemplateCard from './TemplateCard.svelte';
	import SettingsForm from '../settings/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let template = $state<string | null>('default');
</script>

<svelte:head><title>PDF-Vorlagen</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-semibold">PDF-Vorlagen</h1>
		<p class="text-sm text-muted-foreground">
			Einheitlicher Header, Footer, Seitenränder und Format für alle erzeugten Dokumente.
		</p>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title>Einstellungen</Card.Title>
			<Card.Description>
				Logo und Organisationsdaten werden unter „Systemeinstellungen“ gepflegt.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<SettingsForm fields={data.fields} canEdit={true} />
		</Card.Content>
	</Card.Root>

	<section class="space-y-4">
		<div>
			<h2 class="font-semibold">Vorlagen</h2>
			<p class="text-sm text-muted-foreground">
				Vorlagen sind fest im Code hinterlegt (<code class="font-mono text-xs"
					>src/lib/server/core/pdf/templates/</code
				>). Hier kannst du sie nur ansehen; neue Vorlagen werden als Datei im Code ergänzt.
			</p>
		</div>
		<div class="grid gap-6 lg:grid-cols-2">
			{#each data.templateInfo as info (info.id)}
				<TemplateCard {info} />
			{/each}
		</div>
	</section>

	<Card.Root>
		<Card.Header>
			<Card.Title>Test-PDF</Card.Title>
			<Card.Description>
				Erzeugt ein Beispieldokument mit den gespeicherten Einstellungen.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="GET" action="/pdf/test" class="flex flex-wrap items-end gap-3">
				<div class="space-y-1.5">
					<Label for="tpl">Vorlage</Label>
					<SelectField
						id="tpl"
						name="template"
						label="Vorlage"
						options={data.templates.map((t) => ({ value: t.id, label: t.label }))}
						bind:value={template}
					/>
				</div>
				<Button type="submit">PDF herunterladen</Button>
			</form>
		</Card.Content>
	</Card.Root>
</div>
