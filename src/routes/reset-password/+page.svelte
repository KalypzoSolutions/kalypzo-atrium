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

	let { data, form } = $props();
	let loading = $state(false);
</script>

<svelte:head><title>Passwort zuruecksetzen</title></svelte:head>

<main class="flex min-h-screen items-center justify-center bg-muted/40 p-4">
	<Card class="w-full max-w-sm">
		<CardHeader>
			<CardTitle class="text-xl">Neues Passwort</CardTitle>
			<CardDescription>Mindestens 12 Zeichen.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.done}
				<Alert><AlertDescription>Ihr Passwort wurde geaendert.</AlertDescription></Alert>
				<Button href="/login" class="mt-4 w-full">Zur Anmeldung</Button>
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
					<input type="hidden" name="token" value={data.token} />
					<FormField label="Neues Passwort" id="password">
						<Input
							id="password"
							name="password"
							type="password"
							autocomplete="new-password"
							minlength={12}
							required
						/>
					</FormField>
					<FormField label="Passwort bestaetigen" id="confirm">
						<Input
							id="confirm"
							name="confirm"
							type="password"
							autocomplete="new-password"
							minlength={12}
							required
						/>
					</FormField>
					<Button type="submit" disabled={loading}>Passwort speichern</Button>
				</form>
			{/if}
		</CardContent>
	</Card>
</main>
