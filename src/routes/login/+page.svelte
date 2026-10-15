<script lang="ts">
	import { enhance } from '$app/forms';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
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
	const twoFactor = $derived(Boolean(form && 'twoFactor' in form && form.twoFactor));
	const query = $derived(
		data.redirectTo !== '/dashboard' ? `?redirectTo=${encodeURIComponent(data.redirectTo)}` : ''
	);
</script>

<svelte:head><title>Anmelden</title></svelte:head>

<main class="flex min-h-screen items-center justify-center bg-muted/40 p-4">
	<Card class="w-full max-w-sm">
		<CardHeader>
			<CardTitle class="text-xl">Anmelden</CardTitle>
			<CardDescription>
				{twoFactor ? 'Zwei-Faktor-Authentifizierung' : 'Melden Sie sich mit Ihrem Konto an.'}
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.error}
				<Alert variant="destructive" class="mb-4">
					<AlertDescription role="alert">{form.error}</AlertDescription>
				</Alert>
			{/if}

			{#if twoFactor}
				<form
					method="POST"
					action="?/verify{query ? '&' + query.slice(1) : ''}"
					class="grid gap-4"
					use:enhance={() => {
						loading = true;
						return async ({ update }) => {
							loading = false;
							await update();
						};
					}}
				>
					<FormField
						label="Authentifizierungscode"
						id="code"
						hint="6-stelliger Code aus Ihrer Authenticator-App"
					>
						<Input
							id="code"
							name="code"
							inputmode="numeric"
							autocomplete="one-time-code"
							maxlength={7}
							required
							autofocus
						/>
					</FormField>
					<Button type="submit" disabled={loading}>
						{#if loading}<LoaderCircle class="animate-spin" />{/if} Bestaetigen
					</Button>
				</form>
			{:else}
				<form
					method="POST"
					action="?/login{query ? '&' + query.slice(1) : ''}"
					class="grid gap-4"
					use:enhance={() => {
						loading = true;
						return async ({ update }) => {
							loading = false;
							await update({ reset: false });
						};
					}}
				>
					<FormField label="E-Mail" id="email">
						<Input
							id="email"
							name="email"
							type="email"
							autocomplete="username"
							required
							value={form && 'email' in form ? form.email : ''}
						/>
					</FormField>
					<FormField label="Passwort" id="password">
						<Input
							id="password"
							name="password"
							type="password"
							autocomplete="current-password"
							required
						/>
					</FormField>
					<Button type="submit" disabled={loading}>
						{#if loading}<LoaderCircle class="animate-spin" />{/if} Anmelden
					</Button>
					<a
						href="/forgot-password"
						class="text-center text-sm text-muted-foreground hover:underline"
					>
						Passwort vergessen?
					</a>
				</form>
			{/if}
		</CardContent>
	</Card>
</main>
