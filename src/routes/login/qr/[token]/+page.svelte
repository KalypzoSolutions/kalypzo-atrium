<script lang="ts">
	import { enhance } from '$app/forms';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { PageTitle } from '$lib/components/layout';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { t } from '$lib/i18n';
	import { formatDateTime } from '$lib/i18n/intl';

	let { data, form } = $props();
	let busy = $state(false);

	const decided = $derived(form && 'decided' in form ? form.decided : null);
	const status = $derived(decided ?? data.request?.status ?? null);
	const open = $derived(status === 'pending' || status === 'scanned');
</script>

<PageTitle title={t('login.qrConfirm.pageTitle')} />

<main class="flex min-h-dvh flex-col items-center justify-center bg-muted/40 p-4">
	<Card class="w-full max-w-sm">
		<CardHeader>
			<CardTitle level={1} class="flex items-center gap-2 text-section">
				<MonitorSmartphone class="size-5 text-muted-foreground" aria-hidden="true" />
				{t('login.qrConfirm.title')}
			</CardTitle>
			<CardDescription>{t('login.qrConfirm.signedInAs', { name: data.userName })}</CardDescription>
		</CardHeader>
		<CardContent class="grid gap-4">
			{#if form && 'message' in form && form.message}
				<Alert variant="destructive"><AlertDescription>{form.message}</AlertDescription></Alert>
			{/if}

			{#if !data.request}
				<p class="text-sm">{t('login.qrConfirm.invalid')}</p>
			{:else if decided === 'approved' || status === 'consumed'}
				<div class="flex flex-col items-center gap-2 py-4 text-center" role="status">
					<CircleCheck class="size-10 text-success" aria-hidden="true" />
					<p class="font-medium">{t('login.qrConfirm.approvedTitle')}</p>
					<p class="text-sm text-muted-foreground">
						{t('login.qrConfirm.approvedText')}
					</p>
				</div>
			{:else if status === 'denied'}
				<div class="flex flex-col items-center gap-2 py-4 text-center" role="status">
					<CircleX class="size-10 text-muted-foreground" aria-hidden="true" />
					<p class="font-medium">{t('login.qrConfirm.deniedTitle')}</p>
					<p class="text-sm text-muted-foreground">{t('login.qrConfirm.deniedText')}</p>
				</div>
			{:else if !open}
				<p class="text-sm">
					{t('login.qrConfirm.expired')}
				</p>
			{:else}
				<p class="text-sm">
					{t('login.qrConfirm.questionBefore')}
					<strong>{t('login.qrConfirm.questionStrong')}</strong>{t('login.qrConfirm.questionAfter')}
				</p>
				<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border p-3 text-sm">
					<dt class="text-muted-foreground">{t('login.qrConfirm.device')}</dt>
					<dd class="font-medium">{data.request.device}</dd>
					<dt class="text-muted-foreground">{t('login.qrConfirm.ip')}</dt>
					<dd class="font-mono text-xs leading-5">
						{data.request.ip ?? t('login.qrConfirm.unknown')}
					</dd>
					<dt class="text-muted-foreground">{t('login.qrConfirm.requested')}</dt>
					<dd>{formatDateTime(data.request.createdAt)}</dd>
				</dl>
				{#if !data.request.sameNetwork}
					<Alert variant="warning">
						<TriangleAlert />
						<AlertDescription>
							{t('login.qrConfirm.otherNetwork')}
						</AlertDescription>
					</Alert>
				{/if}
				<form
					method="POST"
					class="grid gap-2"
					use:enhance={() => {
						busy = true;
						return async ({ update }) => {
							busy = false;
							await update({ reset: false });
						};
					}}
				>
					<Button type="submit" formaction="?/approve" disabled={busy} class="h-11">
						{#if busy}<LoaderCircle class="animate-spin" />{/if}
						{t('login.qrConfirm.approve')}
					</Button>
					<Button type="submit" formaction="?/deny" variant="outline" disabled={busy} class="h-11">
						{t('login.qrConfirm.deny')}
					</Button>
				</form>
			{/if}
			<a href="/" class="text-center text-sm text-muted-foreground hover:underline">
				{t('login.qrConfirm.home')}
			</a>
		</CardContent>
	</Card>
</main>
