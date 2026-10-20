<script lang="ts">
	import { enhance } from '$app/forms';
	import { FormField } from '$lib/components/layout';
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

<svelte:head><title>Passwort vergessen</title></svelte:head>

<main class="flex min-h-screen items-center justify-center bg-muted/40 p-4">
	<Card class="w-full max-w-sm">
		<CardHeader>
			<CardTitle class="text-xl">Passwort vergessen</CardTitle>
			<CardDescription>Wir senden Ihnen einen Link zum Zurücksetzen.</CardDescription>
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
			<a href="/login" class="mt-4 block text-center text-sm text-muted-foreground hover:underline">
				Zurück zur Anmeldung
			</a>
		</CardContent>
	</Card>
</main>
