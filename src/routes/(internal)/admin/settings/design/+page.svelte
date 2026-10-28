<script lang="ts">
	import { enhance } from '$app/forms';
	import ImageIcon from '@lucide/svelte/icons/image';
	import { ConfirmDialog, FileField, PageTitle } from '$lib/components/layout';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { submitHandler } from '../../_shared/form-utils';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let logoOpen = $state(false);
	let logoFile = $state<File | null>(null);
	let logoBusy = $state(false);
	let logoError = $state('');
	let removeOpen = $state(false);
	let removeForm: HTMLFormElement | null = $state(null);

	const logoHandler = submitHandler({
		busy: (b) => (logoBusy = b),
		error: (m) => (logoError = m),
		success: () => (logoOpen = false)
	});
	const removeHandler = submitHandler({ busy: (b) => (logoBusy = b) });

	let preview = $state<string | null>(null);
	$effect(() => {
		if (!logoFile) {
			preview = null;
			return;
		}
		const url = URL.createObjectURL(logoFile);
		preview = url;
		return () => URL.revokeObjectURL(url);
	});

	function openDialog() {
		logoError = '';
		logoFile = null;
		logoOpen = true;
	}
</script>

<PageTitle title="Design · Einstellungen" />

<Card.Root>
	<Card.Header>
		<Card.Title>Erscheinungsbild</Card.Title>
		<Card.Description>Akzentfarbe und Hintergrund der App-Icons.</Card.Description>
	</Card.Header>
	<Card.Content>
		<SettingsForm fields={data.fields} canEdit={data.canEdit} />
	</Card.Content>
</Card.Root>

<Card.Root>
	<Card.Header>
		<Card.Title>Logo</Card.Title>
		<Card.Description>
			Erscheint in PDF-Dokumenten, in der Seitenleiste, auf der Anmeldeseite, als Favicon im
			Browser-Tab und als App-Icon (Home-Bildschirm, Push-Mitteilungen). Ohne Logo wird das Wappen
			verwendet.
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		<div class="flex flex-wrap items-center gap-4">
			{@render logoBox(data.logoUrl, 'size-20')}
			{#if data.canUploadLogo}
				<div class="flex flex-wrap gap-2">
					<Button variant="outline" size="sm" onclick={openDialog}>
						{data.logoUrl ? 'Logo ändern' : 'Logo hochladen'}
					</Button>
					{#if data.logoUrl}
						<Button variant="ghost" size="sm" onclick={() => (removeOpen = true)}>Entfernen</Button>
					{/if}
				</div>
			{/if}
		</div>
		{#if data.logoUrl}
			<div class="flex flex-wrap items-end gap-4">
				{#each [{ src: '/branding/favicon-32.png', label: 'Favicon', cls: 'size-8' }, { src: '/branding/apple-touch-icon.png', label: 'iPhone', cls: 'size-14 rounded-xl' }, { src: '/branding/maskable-512.png', label: 'Android', cls: 'size-14 rounded-full' }] as icon (icon.label)}
					<figure class="flex flex-col items-center gap-1">
						<img
							src="{icon.src}?v={data.logoUrl.split('v=')[1]}"
							alt="Vorschau {icon.label}"
							class="border object-cover {icon.cls}"
						/>
						<figcaption class="text-xs text-muted-foreground">{icon.label}</figcaption>
					</figure>
				{/each}
			</div>
		{/if}
		{#if !data.canUploadLogo && data.canEdit}
			<p class="text-xs text-muted-foreground">
				Zum Hochladen eines Logos brauchst du zusätzlich Schreibrechte für den Speicher.
			</p>
		{/if}
	</Card.Content>
</Card.Root>

{#snippet logoBox(src: string | null, cls: string)}
	<div
		class="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 {cls}"
	>
		{#if src}
			<img {src} alt="Logo" class="size-full object-contain p-1" />
		{:else}
			<ImageIcon class="size-6 text-muted-foreground" aria-hidden="true" />
			<span class="sr-only">Kein Logo</span>
		{/if}
	</div>
{/snippet}

<Dialog.Root bind:open={logoOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{data.logoUrl ? 'Logo ändern' : 'Logo hochladen'}</Dialog.Title>
			<Dialog.Description>
				PNG, JPEG oder WebP. Nach der Auswahl wählst du den Ausschnitt; quadratisch passt am besten
				für Favicon und App-Icon.
			</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/uploadLogo"
			enctype="multipart/form-data"
			class="grid gap-4"
			use:enhance={logoHandler}
		>
			{#if logoError}
				<Alert variant="destructive"
					><AlertDescription role="alert">{logoError}</AlertDescription></Alert
				>
			{/if}
			<div class="flex items-center gap-4">
				{@render logoBox(preview ?? data.logoUrl, 'size-[72px]')}
				<div class="min-w-0 flex-1">
					<FileField
						id="logo-file"
						name="logo"
						bind:file={logoFile}
						accept="image/png,image/jpeg,image/webp"
						maxBytes={5 * 1024 * 1024}
						crop={{
							shape: 'rect',
							aspect: 1,
							maxEdge: 1024,
							background: 'transparent',
							title: 'Logo zuschneiden'
						}}
						disabled={logoBusy}
					/>
				</div>
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (logoOpen = false)}>
					Abbrechen
				</Button>
				<Button type="submit" disabled={!logoFile || logoBusy}>
					{logoBusy ? 'Lädt hoch …' : 'Speichern'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<form
	bind:this={removeForm}
	method="POST"
	action="?/removeLogo"
	class="hidden"
	use:enhance={removeHandler}
></form>

<ConfirmDialog
	bind:open={removeOpen}
	title="Logo entfernen?"
	description="PDFs erscheinen ohne Logo; Favicon und App-Icon zeigen wieder das Wappen."
	confirmLabel="Entfernen"
	destructive
	onconfirm={() => removeForm?.requestSubmit()}
/>
