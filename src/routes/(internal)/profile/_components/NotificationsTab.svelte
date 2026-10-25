<script lang="ts">
	import { onMount } from 'svelte';
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
	import { ApiClientError, apiFetch, formatDateTimeDe } from '$lib/sdk/client';
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
	let loadError = $state(false);
	let support = $state<PushSupport>('unsupported');
	let permission = $state<ReturnType<typeof pushPermission>>('default');
	let thisEndpoint = $state<string | null>(null);
	let busy = $state(false);
	let android = $state(false);

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
			toast.success('Push ist auf diesem Gerät aktiv.');
		} catch (e) {
			if (e instanceof PushPermissionError) permission = pushPermission();
			toast.error(errorText(e, 'Push konnte nicht aktiviert werden'));
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
			toast.success('Push auf diesem Gerät abgeschaltet.');
		} catch (e) {
			toast.error(errorText(e, 'Push konnte nicht abgeschaltet werden'));
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
			if (r.delivered) toast.success('Test-Benachrichtigung verschickt.');
			else toast.error('Kein Gerät hat die Test-Benachrichtigung angenommen.');
		} catch (e) {
			toast.error(errorText(e, 'Test fehlgeschlagen'));
		} finally {
			busy = false;
			await load();
		}
	}

	async function removeDevice(id: string) {
		try {
			await apiFetch(`/notifications/push/subscriptions/${id}`, { method: 'DELETE' });
			toast.success('Gerät entfernt.');
		} catch (e) {
			toast.error(errorText(e, 'Gerät konnte nicht entfernt werden'));
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
					? 'Diese Benachrichtigung lässt sich nicht abschalten'
					: 'Die E-Mail dazu kommt unabhängig von dieser Einstellung'
				: undefined
		}));
	}

	const DELIVERY_OPTIONS: SegmentedOption<NotificationDelivery>[] = [
		{ value: 'immediate', label: 'Sofort' },
		{ value: 'daily', label: 'Täglich' }
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
			toast.success('Gespeichert', { duration: 1500 });
		} catch (e) {
			Object.assign(item, before);
			toast.error(errorText(e, 'Einstellung konnte nicht gespeichert werden'));
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
				><Smartphone class="size-5" /> Dieses Gerät</CardTitle
			>
			<CardDescription>
				Push-Benachrichtigungen erscheinen direkt auf dem Handy oder Computer – auch wenn EP Intern
				gerade nicht geöffnet ist.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if !data && !loadError}
				<LoadingState label="Geräte" rows={1} rowClass="h-12 w-full" />
			{:else if data && !data.pushAvailable}
				<Alert variant="info">
					<AlertDescription>
						Push-Benachrichtigungen sind in diesem System ausgeschaltet. Alles kommt per E-Mail.
					</AlertDescription>
				</Alert>
			{:else if support === 'ios-install'}
				<Alert variant="info">
					<Share />
					<AlertTitle>Erst zum Home-Bildschirm hinzufügen</AlertTitle>
					<AlertDescription>
						<ol class="list-decimal space-y-1 pl-4">
							<li>In Safari unten auf <strong>Teilen</strong> tippen.</li>
							<li><strong>„Zum Home-Bildschirm“</strong> wählen und bestätigen.</li>
							<li>EP Intern über das neue Symbol öffnen und hier Push aktivieren.</li>
						</ol>
						<p class="mt-2">Push auf dem iPhone/iPad braucht iOS 16.4 oder neuer.</p>
					</AlertDescription>
				</Alert>
			{:else if support === 'insecure'}
				<Alert variant="info">
					<AlertDescription
						>Push funktioniert nur über eine sichere Verbindung (HTTPS).</AlertDescription
					>
				</Alert>
			{:else if support === 'unsupported'}
				<Alert variant="info">
					<AlertDescription>
						Dieser Browser unterstützt keine Push-Benachrichtigungen. Aktuelle Versionen von Chrome,
						Edge, Firefox und Safari können es.
					</AlertDescription>
				</Alert>
			{:else if permission === 'denied' && !thisActive}
				<Alert variant="warning">
					<AlertTitle>Im Browser blockiert</AlertTitle>
					<AlertDescription>
						Benachrichtigungen für diese Seite wurden abgelehnt. Erlaube sie in den
						Website-Einstellungen des Browsers (Schloss-Symbol neben der Adresse) und lade die Seite
						neu.
					</AlertDescription>
				</Alert>
			{:else}
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div class="flex items-center gap-2 text-sm">
						{#if thisActive}
							<Badge variant="secondary"><BellRing class="size-3.5" /> Aktiv</Badge>
							<span class="text-muted-foreground"
								>Dieses Gerät bekommt Push-Benachrichtigungen.</span
							>
						{:else}
							<span class="text-muted-foreground">Push ist auf diesem Gerät nicht aktiv.</span>
						{/if}
					</div>
					<div class="flex flex-wrap gap-2">
						{#if thisActive}
							<Button variant="outline" disabled={busy} onclick={sendTest}>Test senden</Button>
							<Button variant="ghost" disabled={busy} onclick={deactivate}>Abschalten</Button>
						{:else}
							<Button disabled={busy} onclick={activate}>
								<BellRing /> Push aktivieren
							</Button>
						{/if}
					</div>
				</div>
				{#if android}
					<p class="text-muted-foreground text-sm">
						Tipp: Über das Browser-Menü (⋮) → <strong>„Zum Startbildschirm hinzufügen“</strong> öffnet
						sich EP Intern wie eine App.
					</p>
				{/if}
			{/if}

			{#if data && data.devices.length}
				<div class="space-y-2">
					<h3 class="text-sm font-medium">Registrierte Geräte</h3>
					<ul class="divide-y rounded-md border">
						{#each data.devices as d (d.id)}
							<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
								<div class="min-w-0">
									<div class="truncate font-medium">{d.label}</div>
									<div class="text-muted-foreground text-xs">
										seit {formatDateTimeDe(d.createdAt)}{d.lastSuccessAt
											? ` · zuletzt erreicht ${formatDateTimeDe(d.lastSuccessAt)}`
											: ''}
									</div>
								</div>
								<Button
									variant="ghost"
									size="icon"
									aria-label="Gerät {d.label} entfernen"
									onclick={() => removeDevice(d.id)}
								>
									<Trash2 />
								</Button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Was bekomme ich wie?</CardTitle>
			<CardDescription>
				Wähle je Benachrichtigung: <strong>Aus</strong>, <strong>E-Mail</strong>,
				<strong>Beides</strong> oder nur <strong>Push</strong>. Änderungen gelten sofort.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-6">
			{#if loadError}
				<ErrorState message="Einstellungen konnten nicht geladen werden." onretry={load} />
			{:else if !data}
				<LoadingState label="Benachrichtigungen" rows={3} rowClass="h-10 w-full" />
			{:else if !data.groups.length}
				<p class="text-muted-foreground text-sm">
					Für dich gibt es derzeit keine Benachrichtigungen.
				</p>
			{:else}
				{#if wantsPush && (!hasDevices || !data.pushAvailable)}
					<Alert variant="info">
						<AlertDescription>
							Solange kein Gerät für Push aktiv ist, kommen Push-Benachrichtigungen per E-Mail.
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
												label="Kanal für {item.label}"
												value={item.channel}
												options={channelOptions(item)}
												onchange={(v) => save(item, { channel: v })}
											/>
											{#if item.digest && item.channel !== 'off'}
												<SegmentedSlider
													class="h-8 max-w-48"
													label="Zeitpunkt für {item.label}"
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
