<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import {
		ConfirmDialog,
		EntityAvatar,
		FileField,
		FormField,
		SummaryList
	} from '$lib/components/layout';
	import { callAction, submitter } from './actions';
	import type { ProfileData } from './types';

	let { data }: { data: ProfileData } = $props();

	const dateFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' });

	// --- Name
	let name = $state(untrack(() => data.profile.name));
	let nameBusy = $state(false);
	let nameError = $state<string | null>(null);
	const nameDirty = $derived(name.trim() !== data.profile.name && name.trim().length > 0);

	// --- Profilbild
	let avatarOpen = $state(false);
	let avatarFile = $state<File | null>(null);
	let avatarBusy = $state(false);
	let avatarError = $state<string | null>(null);
	let removeOpen = $state(false);
	let preview = $state<string | null>(null);
	$effect(() => {
		if (!avatarFile) {
			preview = null;
			return;
		}
		const url = URL.createObjectURL(avatarFile);
		preview = url;
		return () => URL.revokeObjectURL(url);
	});

	async function removeAvatar() {
		avatarError = null;
		const o = await callAction('removeAvatar');
		if (!o.ok) avatarError = o.error;
	}

	// --- E-Mail
	let emailOpen = $state(false);
	let emailBusy = $state(false);
	let emailError = $state<string | null>(null);

	const summary = $derived([
		{
			label: 'Mitglied seit',
			value: data.createdAt ? dateFmt.format(new Date(data.createdAt)) : '–'
		}
	]);
</script>

<div class="space-y-6">
	<Card>
		<CardHeader><CardTitle class="font-semibold">Profil</CardTitle></CardHeader>
		<CardContent class="max-w-2xl space-y-6">
			<div class="flex flex-wrap items-center gap-4">
				<EntityAvatar name={data.profile.name} src={data.profile.image ?? null} size={72} />
				<div class="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							avatarError = null;
							avatarFile = null;
							avatarOpen = true;
						}}>Bild ändern</Button
					>
					{#if data.profile.image}
						<Button variant="ghost" size="sm" onclick={() => (removeOpen = true)}>Entfernen</Button>
					{/if}
				</div>
			</div>
			{#if avatarError && !avatarOpen}
				<Alert variant="destructive"
					><AlertDescription role="alert">{avatarError}</AlertDescription></Alert
				>
			{/if}

			<form
				method="POST"
				action="?/updateName"
				class="grid gap-4"
				use:enhance={submitter(
					(o) => {
						nameError = o.error;
					},
					{ setBusy: (b) => (nameBusy = b) }
				)}
			>
				<FormField label="Name" id="profile-name" error={nameError}>
					<Input
						id="profile-name"
						name="name"
						bind:value={name}
						autocomplete="name"
						maxlength={100}
						required
						aria-invalid={nameError ? true : undefined}
					/>
				</FormField>
				<Button type="submit" class="w-fit" disabled={!nameDirty || nameBusy}>
					{nameBusy ? 'Speichert …' : 'Speichern'}
				</Button>
			</form>

			<div class="grid gap-1.5">
				<p class="text-sm font-medium">E-Mail-Adresse</p>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<span class="min-w-0 text-sm break-all">{data.profile.email}</span>
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							emailError = null;
							emailOpen = true;
						}}>E-Mail ändern</Button
					>
				</div>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader><CardTitle class="font-semibold">Kontodaten</CardTitle></CardHeader>
		<CardContent class="max-w-2xl space-y-3">
			<SummaryList rows={summary} />
			<div class="grid gap-1.5">
				<p class="text-sm">Rollen</p>
				<div class="flex flex-wrap gap-1.5">
					{#each data.roles as role (role)}
						<Badge variant="secondary">{role}</Badge>
					{:else}
						<span class="text-sm text-muted-foreground">Keine Rolle zugewiesen.</span>
					{/each}
				</div>
				<p class="text-xs text-muted-foreground">
					Rollen vergibt die Administration, einige kommen über Ämter.
				</p>
			</div>
		</CardContent>
	</Card>
</div>

<Dialog.Root bind:open={avatarOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Profilbild ändern</Dialog.Title>
			<Dialog.Description
				>PNG, JPEG oder WebP. Nach der Auswahl wählst du den Ausschnitt.</Dialog.Description
			>
		</Dialog.Header>
		<form
			method="POST"
			action="?/setAvatar"
			enctype="multipart/form-data"
			class="grid gap-4"
			use:enhance={submitter(
				(o) => {
					if (o.ok) avatarOpen = false;
					else avatarError = o.error;
				},
				{ setBusy: (b) => (avatarBusy = b) }
			)}
		>
			{#if avatarError}
				<Alert variant="destructive"
					><AlertDescription role="alert">{avatarError}</AlertDescription></Alert
				>
			{/if}
			<div class="flex items-center gap-4">
				<EntityAvatar
					name={data.profile.name}
					src={preview ?? data.profile.image ?? null}
					size={72}
				/>
				<div class="min-w-0 flex-1">
					<FileField
						id="avatar-file"
						name="avatar"
						bind:file={avatarFile}
						accept="image/png,image/jpeg,image/webp"
						maxBytes={2 * 1024 * 1024}
						crop={{ shape: 'circle', maxEdge: 512, title: 'Profilbild zuschneiden' }}
						disabled={avatarBusy}
					/>
				</div>
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (avatarOpen = false)}>
					Abbrechen
				</Button>
				<Button type="submit" disabled={!avatarFile || avatarBusy}>
					{avatarBusy ? 'Lädt hoch …' : 'Speichern'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<ConfirmDialog
	bind:open={removeOpen}
	title="Profilbild entfernen?"
	description="Danach siehst du wieder deine Initialen."
	confirmLabel="Entfernen"
	destructive
	onconfirm={removeAvatar}
/>

<Dialog.Root bind:open={emailOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>E-Mail-Adresse ändern</Dialog.Title>
			<Dialog.Description>
				Wir schicken einen Bestätigungslink an die neue Adresse. Erst nach dem Klick wechselt deine
				Adresse.
			</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/changeEmail"
			class="grid gap-4"
			use:enhance={submitter(
				(o) => {
					if (o.ok) emailOpen = false;
					else emailError = o.error;
				},
				{ setBusy: (b) => (emailBusy = b) }
			)}
		>
			{#if emailError}
				<Alert variant="destructive"
					><AlertDescription role="alert">{emailError}</AlertDescription></Alert
				>
			{/if}
			<FormField label="Neue E-Mail-Adresse" id="new-email">
				<Input id="new-email" name="newEmail" type="email" autocomplete="email" required />
			</FormField>
			<FormField label="Aktuelles Passwort" id="email-password">
				<Input
					id="email-password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
				/>
			</FormField>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (emailOpen = false)}>
					Abbrechen
				</Button>
				<Button type="submit" disabled={emailBusy}>
					{emailBusy ? 'Sendet …' : 'Bestätigungslink senden'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
