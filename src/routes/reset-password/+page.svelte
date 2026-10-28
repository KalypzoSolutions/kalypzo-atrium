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

	let { data, form } = $props();
	let loading = $state(false);
</script>

<PageTitle title="Passwort zurücksetzen" />

<div class="flex min-h-dvh flex-col bg-muted/40">
	<main class="flex flex-1 items-center justify-center p-4 py-10">
		<Card class="w-full max-w-sm">
			<CardHeader>
				<CardTitle level={1} class="text-section">Neues Passwort</CardTitle>
				<CardDescription>Mindestens 12 Zeichen.</CardDescription>
			</CardHeader>
			<CardContent>
				{#if form?.done}
					<Alert><AlertDescription>Dein Passwort wurde geändert.</AlertDescription></Alert>
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
						<FormField label="Passwort bestätigen" id="confirm">
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
	<LegalLinks class="border-t bg-background/60 px-4 py-4" />
</div>
