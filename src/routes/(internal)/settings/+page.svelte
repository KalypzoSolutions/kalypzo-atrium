<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { FileField } from '$lib/components/layout';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { submitHandler } from './form-utils';
	import SettingsForm from './SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const tabs = [
		{ id: 'system', label: 'System & Organisation', match: /^core\.(system|organization)\./ },
		{ id: 'design', label: 'Design', match: /^core\.design\./ },
		{ id: 'smtp', label: 'E-Mail (SMTP)', match: /^core\.smtp\./ },
		{ id: 'mail', label: 'E-Mail-Layout', match: /^core\.mail\./ }
	];
	let active = $state('system');
	const current = $derived(tabs.find((t) => t.id === active) ?? tabs[0]!);
	const fields = $derived(data.fields.filter((f) => current.match.test(f.key)));

	let previewKey = $state(0);
	let mailBusy = $state(false);
	let logoBusy = $state(false);
	const mailHandler = submitHandler({ busy: (b) => (mailBusy = b), reload: false });
	const logoHandler = submitHandler({ busy: (b) => (logoBusy = b) });
</script>

<svelte:head><title>Systemeinstellungen</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-semibold">Systemeinstellungen</h1>
		<p class="text-sm text-muted-foreground">
			Name, Organisation, Erscheinungsbild und E-Mail-Versand.
		</p>
	</div>

	<div role="tablist" aria-label="Einstellungsbereiche" class="flex flex-wrap gap-1 border-b">
		{#each tabs as t (t.id)}
			<button
				type="button"
				role="tab"
				aria-selected={active === t.id}
				class="-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors {active === t.id
					? 'border-primary text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
				onclick={() => (active = t.id)}
			>
				{t.label}
			</button>
		{/each}
	</div>

	<Card.Root>
		<Card.Content class="pt-6">
			{#key active}
				<SettingsForm {fields} canEdit={data.canEdit} />
			{/key}
		</Card.Content>
	</Card.Root>

	{#if active === 'mail'}
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
					src={`/settings/mail-preview?v=${previewKey}`}
					class="h-[640px] w-full rounded-md border bg-muted/30"
					sandbox=""
				></iframe>
				<Button type="button" variant="outline" size="sm" onclick={() => (previewKey += 1)}>
					Vorschau neu laden
				</Button>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if active === 'design' && data.canUploadLogo}
		<Card.Root>
			<Card.Header>
				<Card.Title>Logo hochladen</Card.Title>
				<Card.Description
					>PNG, JPEG oder WebP, maximal 2 MB. Das Logo erscheint in PDF-Dokumenten.</Card.Description
				>
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
					<Button type="submit" disabled={logoBusy}>{logoBusy ? 'Lade hoch …' : 'Hochladen'}</Button
					>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if (active === 'smtp' || active === 'mail') && data.canEdit}
		<Card.Root>
			<Card.Header>
				<Card.Title>Test-E-Mail</Card.Title>
				<Card.Description
					>Speichern Sie zuerst Ihre Änderungen, dann senden Sie eine Testnachricht.</Card.Description
				>
			</Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/testMail"
					class="flex flex-wrap items-end gap-3"
					use:enhance={mailHandler}
				>
					<div class="space-y-1.5">
						<Label for="to">Empfänger</Label>
						<Input id="to" name="to" type="email" required value={data.email} />
					</div>
					<Button type="submit" variant="outline" disabled={mailBusy}>
						{mailBusy ? 'Sende …' : 'Test-E-Mail senden'}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
