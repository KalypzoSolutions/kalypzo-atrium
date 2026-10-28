<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { FormField, PageTitle } from '$lib/components/layout';
	import LegalLinks from '$lib/components/layout/LegalLinks.svelte';
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
	import QrLoginPanel from './QrLoginPanel.svelte';

	let { data, form } = $props();
	let loading = $state(false);
	/** QR-Anmeldung nur auf größeren Bildschirmen (auf dem Handy selbst sinnlos) */
	let wide = $state(false);
	const twoFactor = $derived(Boolean(form && 'twoFactor' in form && form.twoFactor));
	const query = $derived(
		data.redirectTo !== '/dashboard' ? `?redirectTo=${encodeURIComponent(data.redirectTo)}` : ''
	);
	const logoUrl = $derived(page.data.logoUrl as string | null | undefined);
	const systemName = $derived((page.data.systemName as string | undefined) ?? 'EP Intern');
	const showQr = $derived(wide && !twoFactor);

	onMount(() => {
		const mq = window.matchMedia('(min-width: 768px)');
		const update = () => (wide = mq.matches);
		update();
		mq.addEventListener('change', update);
		return () => mq.removeEventListener('change', update);
	});
</script>

<PageTitle title="Anmelden" />

<div class="flex min-h-dvh flex-col bg-muted/40">
	<main class="flex flex-1 flex-col items-center justify-center gap-6 p-4 py-10">
		<div class="flex flex-col items-center gap-3 text-center">
			{#if logoUrl}
				<img src={logoUrl} alt="" class="size-20 object-contain" />
			{/if}
			<p class="text-lg font-semibold">{systemName}</p>
		</div>

		<Card class="w-full {showQr ? 'max-w-3xl' : 'max-w-sm'}">
			<div class={showQr ? 'grid md:grid-cols-[1fr_auto_1fr]' : ''}>
				<div class="min-w-0">
					<CardHeader>
						<CardTitle level={1} class="text-section">Anmelden</CardTitle>
						<CardDescription>
							{twoFactor ? 'Zwei-Faktor-Authentifizierung' : 'Melde dich mit deinem Konto an.'}
						</CardDescription>
					</CardHeader>
					<CardContent class="pt-4">
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
									hint="6-stelliger Code aus deiner Authenticator-App"
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
									{#if loading}<LoaderCircle class="animate-spin" />{/if} Bestätigen
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
				</div>

				{#if showQr}
					<div class="flex items-center justify-center py-6" aria-hidden="true">
						<div class="flex h-full flex-col items-center gap-2">
							<span class="w-px flex-1 bg-border"></span>
							<span class="text-xs text-muted-foreground uppercase">oder</span>
							<span class="w-px flex-1 bg-border"></span>
						</div>
					</div>
					<section class="min-w-0" aria-labelledby="qr-login-title">
						<CardHeader>
							<CardTitle id="qr-login-title" level={2} class="text-section">
								Mit dem Handy anmelden
							</CardTitle>
							<CardDescription>Ohne Passwort, über dein angemeldetes Handy.</CardDescription>
						</CardHeader>
						<CardContent class="pt-4">
							<QrLoginPanel redirectTo={data.redirectTo} />
						</CardContent>
					</section>
				{/if}
			</div>
		</Card>
	</main>

	<LegalLinks
		class="border-t bg-background/60 px-4 py-4"
		privacyUrl={data.legal?.privacyUrl}
		imprintUrl={data.legal?.imprintUrl}
	/>
</div>
