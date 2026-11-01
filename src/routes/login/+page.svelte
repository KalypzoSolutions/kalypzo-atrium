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
	import { getLocale, LOCALE_LABELS, LOCALES, t } from '$lib/i18n';
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
	const systemName = $derived((page.data.systemName as string | undefined) ?? 'Kalypzo Atrium');
	const showQr = $derived(wide && !twoFactor);
	const currentLocale = $derived((page.data.locale as string | undefined) ?? getLocale());

	onMount(() => {
		const mq = window.matchMedia('(min-width: 768px)');
		const update = () => (wide = mq.matches);
		update();
		mq.addEventListener('change', update);
		return () => mq.removeEventListener('change', update);
	});
</script>

<PageTitle title={t('login.title')} />

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
						<CardTitle level={1} class="text-section">{t('login.title')}</CardTitle>
						<CardDescription>
							{twoFactor ? t('login.twoFactorTitle') : t('login.subtitle')}
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
								<FormField label={t('login.codeLabel')} id="code" hint={t('login.codeHint')}>
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
									{#if loading}<LoaderCircle class="animate-spin" />{/if}
									{t('login.confirm')}
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
								<FormField label={t('login.email')} id="email">
									<Input
										id="email"
										name="email"
										type="email"
										autocomplete="username"
										required
										value={form && 'email' in form ? form.email : ''}
									/>
								</FormField>
								<FormField label={t('login.password')} id="password">
									<Input
										id="password"
										name="password"
										type="password"
										autocomplete="current-password"
										required
									/>
								</FormField>
								<Button type="submit" disabled={loading}>
									{#if loading}<LoaderCircle class="animate-spin" />{/if}
									{t('login.submit')}
								</Button>
								<a
									href="/forgot-password"
									class="text-center text-sm text-muted-foreground hover:underline"
								>
									{t('login.forgotPassword')}
								</a>
							</form>
						{/if}
					</CardContent>
				</div>

				{#if showQr}
					<div class="flex items-center justify-center py-6" aria-hidden="true">
						<div class="flex h-full flex-col items-center gap-2">
							<span class="w-px flex-1 bg-border"></span>
							<span class="text-xs text-muted-foreground uppercase">{t('login.or')}</span>
							<span class="w-px flex-1 bg-border"></span>
						</div>
					</div>
					<section class="min-w-0" aria-labelledby="qr-login-title">
						<CardHeader>
							<CardTitle id="qr-login-title" level={2} class="text-section">
								{t('login.qrTitle')}
							</CardTitle>
							<CardDescription>{t('login.qrSubtitle')}</CardDescription>
						</CardHeader>
						<CardContent class="pt-4">
							<QrLoginPanel redirectTo={data.redirectTo} />
						</CardContent>
					</section>
				{/if}
			</div>
		</Card>
	</main>

	<div class="flex flex-col items-center gap-2 border-t bg-background/60 px-4 py-4">
		<form
			method="POST"
			action="?/locale{query ? '&' + query.slice(1) : ''}"
			class="flex items-center gap-1 text-xs text-muted-foreground"
			aria-label={t('login.language')}
		>
			{#each LOCALES as code, i (code)}
				{#if i > 0}<span aria-hidden="true">·</span>{/if}
				<button
					type="submit"
					name="locale"
					value={code}
					lang={code}
					aria-current={code === currentLocale ? 'true' : undefined}
					class="rounded px-1.5 py-0.5 hover:underline {code === currentLocale
						? 'font-medium text-foreground'
						: ''}"
				>
					{LOCALE_LABELS[code]}
				</button>
			{/each}
		</form>
		<LegalLinks privacyUrl={data.legal?.privacyUrl} imprintUrl={data.legal?.imprintUrl} />
	</div>
</div>
