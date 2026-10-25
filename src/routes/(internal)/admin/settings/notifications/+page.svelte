<script lang="ts">
	import { enhance } from '$app/forms';
	import { ConfirmDialog, PageTitle } from '$lib/components/layout';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { submitHandler } from '../../_shared/form-utils';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let confirmOpen = $state(false);
	let rotating = $state(false);
	let rotateForm = $state<HTMLFormElement | null>(null);
	const rotateHandler = submitHandler({ busy: (b) => (rotating = b) });
</script>

<PageTitle title="Benachrichtigungen · Einstellungen" />

<div class="space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>Push-Benachrichtigungen</Card.Title>
			<Card.Description>
				Benachrichtigungen direkt aufs Handy oder den Computer (Web Push). Jede Person wählt im
				Profil unter „Benachrichtigungen“, was sie per E-Mail, Push oder beidem bekommt. Ohne Push
				kommt alles per E-Mail.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<SettingsForm fields={data.fields} canEdit={data.canEdit} />
			<p class="text-muted-foreground text-sm">
				Registrierte Geräte: <span class="text-foreground font-medium tabular-nums"
					>{data.devices}</span
				>
			</p>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Schlüssel (VAPID)</Card.Title>
			<Card.Description>
				Werden automatisch erzeugt; der private Schlüssel ist verschlüsselt gespeichert. Neu
				erzeugen nur, wenn er in falsche Hände geraten sein könnte – danach müssen alle Personen
				Push auf ihren Geräten neu aktivieren.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div>
				<div class="text-muted-foreground mb-1 text-xs">Öffentlicher Schlüssel</div>
				<code class="bg-muted block rounded-md px-3 py-2 text-xs break-all">{data.publicKey}</code>
			</div>
			{#if data.canEdit}
				<form method="POST" action="?/rotate" bind:this={rotateForm} use:enhance={rotateHandler}>
					<Button
						type="button"
						variant="outline"
						disabled={rotating}
						onclick={() => (confirmOpen = true)}
					>
						Schlüssel neu erzeugen
					</Button>
				</form>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Push-Schlüssel neu erzeugen?"
	description="Alle {data.devices} registrierten Geräte verlieren ihr Push-Abo und müssen Push im Profil neu aktivieren."
	confirmLabel="Neu erzeugen"
	destructive
	onconfirm={() => rotateForm?.requestSubmit()}
/>
