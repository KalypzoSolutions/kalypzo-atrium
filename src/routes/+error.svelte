<script lang="ts">
	import { page } from '$app/state';
	import { PageTitle } from '$lib/components/layout';
	import { Button } from '$lib/components/ui/button';
	import { t } from '$lib/i18n';
</script>

<PageTitle title={t('error-page.title', { status: page.status })} />

<main class="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
	<p class="text-5xl font-semibold text-muted-foreground">{page.status}</p>
	<h1 class="text-title">
		{page.status === 404 ? t('error-page.notFound') : t('error-page.generic')}
	</h1>
	<p class="max-w-md text-sm text-muted-foreground">{page.error?.message}</p>
	{#if page.error?.requestId}
		<p class="text-xs text-muted-foreground">
			{t('error-page.reference', { id: page.error.requestId })}
		</p>
	{/if}
	<Button href="/dashboard">{t('error-page.toDashboard')}</Button>
</main>
