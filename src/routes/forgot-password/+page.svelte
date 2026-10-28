<script lang="ts">
	import LegalLinks from '$lib/components/layout/LegalLinks.svelte';
	import { enhance } from '$app/forms';
	import { FormField, PageTitle } from '$lib/components/layout';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';

	let { form } = $props();
	let loading = $state(false);
</script>

<PageTitle title="Passwort vergessen" />

<div class="flex min-h-dvh flex-col bg-muted/40">
	<main class="flex flex-1 items-center justify-center p-4 py-10">
		<Card class="w-full max-w-sm">
			<CardHeader>
				<CardTitle level={1} class="text-section">Passwort vergessen</CardTitle>
				<CardDescription>Wir senden dir einen Link zum Zurücksetzen.</CardDescription>
			</CardHeader>
			<CardContent>
				{#if form?.sent}
					<Alert
						><AlertDescription>
							Falls ein Konto mit dieser Adresse existiert, wurde eine E-Mail versendet.
						</AlertDescription></Alert
					>
				{:else}
					{#if form?.error}
						<Alert variant="destructive" class="mb-4"
							><AlertDescription role="alert">{form.error}</AlertDescription></Alert
						>
					{/if}
					<form
						method="POST"
						class="grid gap-4"
						use:enhance={() => {
							loading = true;
							return async ({ update }) => {
								loading = false;
								await update();
							};
						}}
					>
						<FormField label="E-Mail" id="email">
							<Input id="email" name="email" type="email" autocomplete="email" required />
						</FormField>
						<Button type="submit" disabled={loading}>Link anfordern</Button>
					</form>
				{/if}
				<a
					href="/login"
					class="mt-4 block text-center text-sm text-muted-foreground hover:underline"
				>
					Zurück zur Anmeldung
				</a>
			</CardContent>
		</Card>
	</main>
	<LegalLinks class="border-t bg-background/60 px-4 py-4" />
</div>
