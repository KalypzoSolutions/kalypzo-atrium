<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import { formatDateTime } from '$lib/i18n/intl';
	import { toast } from 'svelte-sonner';
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import Share from '@lucide/svelte/icons/share';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { ErrorState, LoadingState } from '$lib/components/layout';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { SegmentedSlider, type SegmentedOption } from '$lib/components/ui/segmented-slider';
	import { ApiClientError, apiFetch } from '$lib/sdk/client';
	import {
		PushPermissionError,
		currentSubscription,
		disablePush,
		enablePush,
		isStandalone,
		pushPermission,
		pushSupport,
		type PushSupport
	} from '$lib/sdk/client/push';
	import { serviceWorkerVersion } from '$lib/sdk/client/sw-navigation';
	import { version as appVersion } from '$app/environment';
	import {
		NOTIFICATION_CHANNELS,
		NOTIFICATION_CHANNEL_LABELS,
		allowedChannels,
		type NotificationChannel,
		type NotificationDelivery,
		type NotificationPrefItem,
		type NotificationPrefsResponse
	} from '$lib/sdk/types/notifications';

	let data = $state<NotificationPrefsResponse | null>(null);
	/** Name des Systems für die Hinweise („… auch wenn <Name> gerade nicht geöffnet ist“) */
	const appName = $derived(
		(page.data as { systemName?: string }).systemName || t('profile.notifications.appFallback')
	);
	let loadError = $state(false);
	let support = $state<PushSupport>('unsupported');
	let permission = $state<ReturnType<typeof pushPermission>>('default');
	let thisEndpoint = $state<string | null>(null);
	let busy = $state(false);
	let android = $state(false);
	/** Version des Service Workers auf diesem Gerät (`null` = keiner aktiv) */
	let swVersion = $state<string | null>(null);

	async function load() {
		loadError = false;
		try {
			data = await apiFetch<NotificationPrefsResponse>('/notifications/preferences');
		} catch {
			loadError = true;
		}
	}

	async function refreshDevice() {
		support = pushSupport();
		permission = pushPermission();
		thisEndpoint = (await currentSubscription().catch(() => null))?.endpoint ?? null;
	}

	onMount(() => {
		android = /Android/.test(navigator.userAgent) && !isStandalone();
		void refreshDevice();
		void load();
		void serviceWorkerVersion()
			.then((v) => (swVersion = v))
			.catch(() => undefined);
	});

	const thisActive = $derived(thisEndpoint !== null && (data?.devices.length ?? 0) > 0);
	const hasDevices = $derived((data?.devices.length ?? 0) > 0);
	const wantsPush = $derived(
		data?.groups.some((g) => g.items.some((i) => i.channel === 'push' || i.channel === 'both')) ??
			false
	);

	function errorText(e: unknown, fallback: string) {
		return e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : fallback;
	}

	async function activate() {
		busy = true;
		try {
			await enablePush();
			toast.success(t('profile.notifications.pushEnabled'));
		} catch (e) {
			if (e instanceof PushPermissionError) permission = pushPermission();
			toast.error(errorText(e, t('profile.notifications.pushEnableFailed')));
		} finally {
			busy = false;
			await refreshDevice();
			await load();
		}
	}

	async function deactivate() {
		busy = true;
		try {
			await disablePush();
			toast.success(t('profile.notifications.pushDisabled'));
		} catch (e) {
			toast.error(errorText(e, t('profile.notifications.pushDisableFailed')));
		} finally {
			busy = false;
			await refreshDevice();
			await load();
		}
	}

	async function sendTest() {
		busy = true;
		try {
			const r = await apiFetch<{ delivered: boolean }>('/notifications/push/test', {
				method: 'POST'
			});
			if (r.delivered) toast.success(t('profile.notifications.testSent'));
			else toast.error(t('profile.notifications.testNotDelivered'));
		} catch (e) {
			toast.error(errorText(e, t('profile.notifications.testFailed')));
		} finally {
			busy = false;
			await load();
		}
	}

	async function removeDevice(id: string) {
		try {
			await apiFetch(`/notifications/push/subscriptions/${id}`, { method: 'DELETE' });
			toast.success(t('profile.notifications.deviceRemoved'));
		} catch (e) {
			toast.error(errorText(e, t('profile.notifications.deviceRemoveFailed')));
		}
		await refreshDevice();
		await load();
	}

	function channelOptions(item: NotificationPrefItem): SegmentedOption<NotificationChannel>[] {
		const allowed = allowedChannels(item);
		return NOTIFICATION_CHANNELS.map((c) => ({
			value: c,
			label: NOTIFICATION_CHANNEL_LABELS[c],
			disabled: !allowed.includes(c),
			hint: !allowed.includes(c)
				? item.mandatory
					? t('profile.notifications.mandatoryHint')
					: t('profile.notifications.emailIndependentHint')
				: undefined
		}));
	}

	const DELIVERY_OPTIONS: SegmentedOption<NotificationDelivery>[] = [
		{ value: 'immediate', label: t('profile.notifications.immediate') },
		{ value: 'daily', label: t('profile.notifications.daily') }
	];

	async function save(
		item: NotificationPrefItem,
		patch: { channel?: NotificationChannel; delivery?: NotificationDelivery }
	) {
		const before = { channel: item.channel, delivery: item.delivery };
		Object.assign(item, patch);
		try {
			const saved = await apiFetch<{
				channel: NotificationChannel;
				delivery: NotificationDelivery;
			}>('/notifications/preferences', {
				method: 'PUT',
				body: JSON.stringify({
					type: item.type,
					scope: item.scope,
					channel: item.channel,
					delivery: item.delivery
				})
			});
			Object.assign(item, saved);
			toast.success(t('profile.notifications.saved'), { duration: 1500 });
		} catch (e) {
			Object.assign(item, before);
			toast.error(errorText(e, t('profile.notifications.saveFailed')));
		}
	}

	function subgroups(items: NotificationPrefItem[]) {
		const out: { label: string | null; items: NotificationPrefItem[] }[] = [];
		for (const i of items) {
			const last = out.at(-1);
			if (last && last.label === i.group) last.items.push(i);
			else out.push({ label: i.group, items: [i] });
		}
		return out;
	}
</script>

<div class="space-y-6">
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2"
				><Smartphone class="size-5" />
				{t('profile.notifications.thisDevice')}</CardTitle
			>
			<CardDescription>
				{t('profile.notifications.intro', { app: appName })}
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if !data && !loadError}
				<LoadingState label={t('profile.notifications.devices')} rows={1} rowClass="h-12 w-full" />
			{:else if data && !data.pushAvailable}
				<Alert variant="info">
					<AlertDescription>
						{t('profile.notifications.pushOff')}
					</AlertDescription>
				</Alert>
			{:else if support === 'ios-install'}
				<Alert variant="info">
					<Share />
					<AlertTitle>{t('profile.notifications.ios.title')}</AlertTitle>
					<AlertDescription>
						<ol class="list-decimal space-y-1 pl-4">
							<li>
								{t('profile.notifications.ios.step1Before')}
								<strong>{t('profile.notifications.ios.step1Strong')}</strong>
								{t('profile.notifications.ios.step1After')}
							</li>
							<li>
								<strong>{t('profile.notifications.ios.step2Strong')}</strong>
								{t('profile.notifications.ios.step2After')}
							</li>
							<li>{t('profile.notifications.ios.step3', { app: appName })}</li>
						</ol>
						<p class="mt-2">{t('profile.notifications.ios.version')}</p>
					</AlertDescription>
				</Alert>
			{:else if support === 'insecure'}
				<Alert variant="info">
					<AlertDescription>{t('profile.notifications.insecure')}</AlertDescription>
				</Alert>
			{:else if support === 'unsupported'}
				<Alert variant="info">
					<AlertDescription>
						{t('profile.notifications.unsupported')}
					</AlertDescription>
				</Alert>
			{:else if permission === 'denied' && !thisActive}
				<Alert variant="warning">
					<AlertTitle>{t('profile.notifications.blockedTitle')}</AlertTitle>
					<AlertDescription>
						{t('profile.notifications.blockedText')}
					</AlertDescription>
				</Alert>
			{:else}
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div class="flex items-center gap-2 text-sm">
						{#if thisActive}
							<Badge variant="secondary"
								><BellRing class="size-3.5" /> {t('profile.notifications.active')}</Badge
							>
							<span class="text-muted-foreground"
								>{t('profile.notifications.thisDeviceActive')}</span
							>
						{:else}
							<span class="text-muted-foreground"
								>{t('profile.notifications.thisDeviceInactive')}</span
							>
						{/if}
					</div>
					<div class="flex flex-wrap gap-2">
						{#if thisActive}
							<Button variant="outline" disabled={busy} onclick={sendTest}
								>{t('profile.notifications.sendTest')}</Button
							>
							<Button variant="ghost" disabled={busy} onclick={deactivate}
								>{t('profile.notifications.disable')}</Button
							>
						{:else}
							<Button disabled={busy} onclick={activate}>
								<BellRing />
								{t('profile.notifications.enable')}
							</Button>
						{/if}
					</div>
				</div>
				{#if android}
					<p class="text-muted-foreground text-sm">
						{t('profile.notifications.androidBefore')}
						<strong>{t('profile.notifications.androidStrong')}</strong>
						{t('profile.notifications.androidAfter', { app: appName })}
					</p>
				{/if}
			{/if}

			{#if data && data.devices.length}
				<div class="space-y-2">
					<h3 class="text-sm font-medium">{t('profile.notifications.registeredDevices')}</h3>
					<ul class="divide-y rounded-md border">
						{#each data.devices as d (d.id)}
							<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
								<div class="min-w-0">
									<div class="truncate font-medium">{d.label}</div>
									<div class="text-muted-foreground text-xs">
										{t('profile.notifications.deviceSince', {
											date: formatDateTime(d.createdAt)
										})}{d.lastSuccessAt
											? t('profile.notifications.deviceLastReached', {
													date: formatDateTime(d.lastSuccessAt)
												})
											: ''}
									</div>
								</div>
								<Button
									variant="ghost"
									size="icon"
									aria-label={t('profile.notifications.removeDevice', { label: d.label })}
									onclick={() => removeDevice(d.id)}
								>
									<Trash2 />
								</Button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if swVersion}
				<p class="text-muted-foreground text-xs">
					{t('profile.notifications.appVersion', { version: swVersion })}{swVersion !== appVersion
						? t('profile.notifications.appVersionOutdated')
						: ''}
				</p>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>{t('profile.notifications.prefsTitle')}</CardTitle>
			<CardDescription>
				{t('profile.notifications.prefsBefore')}
				<strong>{t('profile.notifications.prefsOff')}</strong>{t('profile.notifications.prefsSep')}
				<strong>{t('profile.notifications.prefsEmail')}</strong>{t(
					'profile.notifications.prefsSep'
				)}
				<strong>{t('profile.notifications.prefsBoth')}</strong>
				{t('profile.notifications.prefsOr')}
				<strong>{t('profile.notifications.prefsPush')}</strong>{t(
					'profile.notifications.prefsAfter'
				)}
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-6">
			{#if loadError}
				<ErrorState message={t('profile.notifications.loadFailed')} onretry={load} />
			{:else if !data}
				<LoadingState label={t('profile.notifications.title')} rows={3} rowClass="h-10 w-full" />
			{:else if !data.groups.length}
				<p class="text-muted-foreground text-sm">
					{t('profile.notifications.none')}
				</p>
			{:else}
				{#if wantsPush && (!hasDevices || !data.pushAvailable)}
					<Alert variant="info">
						<AlertDescription>
							{t('profile.notifications.noDeviceFallback')}
						</AlertDescription>
					</Alert>
				{/if}
				{#each data.groups as g (g.id)}
					<section class="space-y-3" aria-labelledby="notif-{g.id}">
						<h3 id="notif-{g.id}" class="text-sm font-semibold">{g.label}</h3>
						{#each subgroups(g.items) as sg, si (si)}
							{#if sg.label}
								<div class="text-muted-foreground pt-1 text-xs font-medium tracking-wide uppercase">
									{sg.label}
								</div>
							{/if}
							<ul class="divide-y rounded-md border">
								{#each sg.items as item (item.type + '|' + item.scope)}
									<li
										class="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
									>
										<div class="min-w-0 sm:pr-4">
											<div class="text-sm font-medium">{item.label}</div>
											{#if item.description}
												<div class="text-muted-foreground text-xs">{item.description}</div>
											{/if}
										</div>
										<div class="flex w-full shrink-0 flex-col gap-2 sm:w-80">
											<SegmentedSlider
												label={t('profile.notifications.channelFor', { label: item.label })}
												value={item.channel}
												options={channelOptions(item)}
												onchange={(v) => save(item, { channel: v })}
											/>
											{#if item.digest && item.channel !== 'off'}
												<SegmentedSlider
													class="h-8 max-w-48"
													label={t('profile.notifications.deliveryFor', { label: item.label })}
													value={item.delivery}
													options={DELIVERY_OPTIONS}
													onchange={(v) => save(item, { delivery: v })}
												/>
											{/if}
										</div>
									</li>
								{/each}
							</ul>
						{/each}
					</section>
				{/each}
			{/if}
		</CardContent>
	</Card>
</div>
