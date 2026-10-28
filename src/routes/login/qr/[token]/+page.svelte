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
	import { formatDateTimeDe } from '$lib/sdk/dates';

	let { data, form } = $props();
	let busy = $state(false);

	const decided = $derived(form && 'decided' in form ? form.decided : null);
	const status = $derived(decided ?? data.request?.status ?? null);
	const open = $derived(status === 'pending' || status === 'scanned');
</script>

<PageTitle title="Anmeldung bestätigen" />

<main class="flex min-h-dvh flex-col items-center justify-center bg-muted/40 p-4">
	<Card class="w-full max-w-sm">
		<CardHeader>
			<CardTitle level={1} class="flex items-center gap-2 text-section">
				<MonitorSmartphone class="size-5 text-muted-foreground" aria-hidden="true" />
				Anmeldung per QR-Code
			</CardTitle>
			<CardDescription>Angemeldet als {data.userName}</CardDescription>
		</CardHeader>
		<CardContent class="grid gap-4">
			{#if form && 'message' in form && form.message}
				<Alert variant="destructive"><AlertDescription>{form.message}</AlertDescription></Alert>
			{/if}

			{#if !data.request}
				<p class="text-sm">Dieser QR-Code ist ungültig. Fordere am anderen Gerät einen neuen an.</p>
			{:else if decided === 'approved' || status === 'consumed'}
				<div class="flex flex-col items-center gap-2 py-4 text-center" role="status">
					<CircleCheck class="size-10 text-success" aria-hidden="true" />
					<p class="font-medium">Anmeldung bestätigt</p>
					<p class="text-sm text-muted-foreground">
						Das andere Gerät wird jetzt angemeldet. Du kannst diese Seite schließen.
					</p>
				</div>
			{:else if status === 'denied'}
				<div class="flex flex-col items-center gap-2 py-4 text-center" role="status">
					<CircleX class="size-10 text-muted-foreground" aria-hidden="true" />
					<p class="font-medium">Anmeldung abgelehnt</p>
					<p class="text-sm text-muted-foreground">Am anderen Gerät wurde niemand angemeldet.</p>
				</div>
			{:else if !open}
				<p class="text-sm">
					Dieser QR-Code ist abgelaufen oder wurde schon verwendet. Fordere am anderen Gerät einen
					neuen an.
				</p>
			{:else}
				<p class="text-sm">
					Möchtest du dich mit deinem Konto auf diesem Gerät anmelden? Bestätige nur, wenn du
					<strong>selbst gerade davor sitzt</strong>.
				</p>
				<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border p-3 text-sm">
					<dt class="text-muted-foreground">Gerät</dt>
					<dd class="font-medium">{data.request.device}</dd>
					<dt class="text-muted-foreground">IP-Adresse</dt>
					<dd class="font-mono text-xs leading-5">{data.request.ip ?? 'unbekannt'}</dd>
					<dt class="text-muted-foreground">Angefordert</dt>
					<dd>{formatDateTimeDe(data.request.createdAt)}</dd>
				</dl>
				{#if !data.request.sameNetwork}
					<Alert variant="warning">
						<TriangleAlert />
						<AlertDescription>
							Das Gerät ist in einem anderen Netz als dein Handy. Hat dir jemand diesen Code
							geschickt? Dann tippe auf „Ablehnen“.
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
						{#if busy}<LoaderCircle class="animate-spin" />{/if} Anmelden
					</Button>
					<Button type="submit" formaction="?/deny" variant="outline" disabled={busy} class="h-11">
						Ablehnen
					</Button>
				</form>
			{/if}
			<a href="/" class="text-center text-sm text-muted-foreground hover:underline">
				Zur Startseite
			</a>
		</CardContent>
	</Card>
</main>
