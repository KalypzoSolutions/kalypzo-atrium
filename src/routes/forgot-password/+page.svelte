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
	import { t } from '$lib/i18n';

	let { form } = $props();
	let loading = $state(false);
</script>

<PageTitle title={t('password.forgot.title')} />

<div class="flex min-h-dvh flex-col bg-muted/40">
	<main class="flex flex-1 items-center justify-center p-4 py-10">
		<Card class="w-full max-w-sm">
			<CardHeader>
				<CardTitle level={1} class="text-section">{t('password.forgot.title')}</CardTitle>
				<CardDescription>{t('password.forgot.subtitle')}</CardDescription>
			</CardHeader>
			<CardContent>
				{#if form?.sent}
					<Alert
						><AlertDescription>
							{t('password.forgot.sent')}
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
						<FormField label={t('password.forgot.email')} id="email">
							<Input id="email" name="email" type="email" autocomplete="email" required />
						</FormField>
						<Button type="submit" disabled={loading}>{t('password.forgot.submit')}</Button>
					</form>
				{/if}
				<a
					href="/login"
					class="mt-4 block text-center text-sm text-muted-foreground hover:underline"
				>
					{t('password.backToLogin')}
				</a>
			</CardContent>
		</Card>
	</main>
	<LegalLinks class="border-t bg-background/60 px-4 py-4" />
</div>
