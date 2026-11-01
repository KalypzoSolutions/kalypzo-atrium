<script lang="ts">
	/**
	 * „Mit dem Handy anmelden“: zeigt einen QR-Code, den ein angemeldetes Handy bestätigt. Der Code gilt 2 Minuten
	 * und wird automatisch erneuert, solange die Seite sichtbar ist; nach der Bestätigung meldet sich dieser Browser an.
	 */
	import { onDestroy, onMount } from 'svelte';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import { Button } from '$lib/components/ui/button';
	import { t } from '$lib/i18n';

	let { redirectTo }: { redirectTo: string } = $props();

	type State =
		'loading' | 'pending' | 'scanned' | 'approved' | 'done' | 'expired' | 'denied' | 'error';
	const POLL_MS = 2000;
	/** Automatisch erneuern höchstens so oft (danach Knopf), damit offene Tabs nicht endlos Codes anlegen */
	const MAX_RENEW = 15;

	let phase = $state<State>('loading');
	let qr = $state<string | null>(null);
	let expiresAt = $state(0);
	let now = $state(Date.now());
	let message = $state('');
	let renewals = 0;
	let timer: ReturnType<typeof setInterval> | null = null;
	let claiming = false;

	const secondsLeft = $derived(Math.max(0, Math.ceil((expiresAt - now) / 1000)));

	async function request() {
		phase = 'loading';
		message = '';
		try {
			const res = await fetch('/login/qr', { method: 'POST' });
			const body = await res.json();
			if (!res.ok) throw new Error(body?.message ?? t('login.qr.createFailed'));
			qr = body.qr;
			expiresAt = Date.parse(body.expiresAt);
			phase = 'pending';
		} catch (e) {
			phase = 'error';
			message = e instanceof Error ? e.message : t('login.qr.createFailed');
		}
	}

	async function claim() {
		if (claiming) return;
		claiming = true;
		phase = 'approved';
		try {
			const res = await fetch('/login/qr/claim', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ redirectTo })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body?.message ?? t('login.errors.loginFailed'));
			phase = 'done';
			// Voller Seitenwechsel: das neue Sitzungs-Cookie gilt für alle weiteren Anfragen
			window.location.assign(body.redirectTo ?? '/');
		} catch (e) {
			phase = 'error';
			message = e instanceof Error ? e.message : t('login.errors.loginFailed');
		} finally {
			claiming = false;
		}
	}

	async function poll() {
		now = Date.now();
		if (document.hidden || claiming) return;
		if (phase !== 'pending' && phase !== 'scanned') return;
		if (now >= expiresAt) return renew();
		try {
			const res = await fetch('/login/qr', { cache: 'no-store' });
			const { status } = (await res.json()) as { status: State | 'consumed' };
			if (status === 'approved') await claim();
			else if (status === 'scanned' || status === 'pending') phase = status;
			else if (status === 'denied') phase = 'denied';
			else await renew();
		} catch {
			// Netzwerkfehler: beim nächsten Durchlauf erneut versuchen
		}
	}

	function renew() {
		if (renewals >= MAX_RENEW) {
			phase = 'expired';
			return;
		}
		renewals++;
		return request();
	}

	function restart() {
		renewals = 0;
		void request();
	}

	onMount(() => {
		void request();
		timer = setInterval(poll, POLL_MS);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});
</script>

<div class="flex flex-col items-center gap-4 text-center">
	<div
		class="relative flex size-52 items-center justify-center overflow-hidden rounded-xl border bg-white p-2"
	>
		{#if qr && phase !== 'error'}
			<img
				src={qr}
				alt={t('login.qr.alt')}
				class="size-full transition-opacity {phase === 'pending' || phase === 'scanned'
					? ''
					: 'opacity-15'}"
			/>
		{/if}
		{#if phase === 'loading'}
			<LoaderCircle class="absolute size-8 animate-spin text-muted-foreground" aria-hidden="true" />
		{:else if phase === 'approved' || phase === 'done'}
			<CircleCheck class="absolute size-12 text-success" aria-hidden="true" />
		{:else if phase === 'expired' || phase === 'denied' || phase === 'error'}
			<Button variant="outline" size="sm" class="absolute" onclick={restart}>
				<RefreshCw />
				{t('login.qr.newCode')}
			</Button>
		{/if}
	</div>

	<div class="min-h-14 space-y-1 text-sm" aria-live="polite">
		{#if phase === 'scanned'}
			<p class="flex items-center justify-center gap-1.5 font-medium">
				<Smartphone class="size-4" aria-hidden="true" />
				{t('login.qr.confirmOnPhone')}
			</p>
		{:else if phase === 'approved' || phase === 'done'}
			<p class="font-medium">{t('login.qr.approved')}</p>
		{:else if phase === 'denied'}
			<p class="font-medium">{t('login.qr.denied')}</p>
		{:else if phase === 'expired'}
			<p class="text-muted-foreground">{t('login.qr.expired')}</p>
		{:else if phase === 'error'}
			<p class="text-destructive" role="alert">{message}</p>
		{:else}
			<p class="text-muted-foreground">
				{t('login.qr.scanHint')}
			</p>
		{/if}
		{#if (phase === 'pending' || phase === 'scanned') && secondsLeft > 0}
			<p class="text-xs text-muted-foreground tabular-nums">
				{t('login.qr.renewsIn', { seconds: secondsLeft })}
			</p>
		{/if}
	</div>
</div>
