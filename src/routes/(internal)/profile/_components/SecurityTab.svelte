<script lang="ts">
	import { enhance } from '$app/forms';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Copy from '@lucide/svelte/icons/copy';
	import { toast } from 'svelte-sonner';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { ConfirmDialog, EmptyState, FormField } from '$lib/components/layout';
	import { intlLocale, t } from '$lib/i18n';
	import { callAction, submitter } from './actions';
	import type { ProfileData } from './types';
	import { describeUserAgent } from '$lib/user-agent';

	let { data }: { data: ProfileData } = $props();

	const dateTime = new Intl.DateTimeFormat(intlLocale(), {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
	const dateOnly = new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' });

	// --- Passwort
	let pwBusy = $state(false);
	let pwError = $state<string | null>(null);
	let revokeOthersOnChange = $state(true);

	// --- 2FA
	let enableOpen = $state(false);
	let disableOpen = $state(false);
	let tfBusy = $state(false);
	let tfError = $state<string | null>(null);
	let setup = $state<{ qr: string; backupCodes: string[] } | null>(null);
	let saved = $state(false);

	async function copyCodes() {
		if (!setup) return;
		try {
			await navigator.clipboard.writeText(setup.backupCodes.join('\n'));
			toast.success(t('profile.security.codesCopied'));
		} catch {
			toast.error(t('profile.security.copyFailed'));
		}
	}

	// --- Sitzungen
	let sessionError = $state<string | null>(null);
	let revokeAllOpen = $state(false);
	const others = $derived(data.sessions.filter((s) => !s.current));

	async function revokeOne(id: string) {
		sessionError = null;
		const o = await callAction('revokeSession', { id });
		if (!o.ok) sessionError = o.error;
	}
	async function revokeOthers() {
		sessionError = null;
		const o = await callAction('revokeOtherSessions');
		if (!o.ok) sessionError = o.error;
	}

	const isMobile = (ua: string | null) => !!ua && /mobile|android|iphone|ipad/i.test(ua);

	// --- API-Schlüssel
	const keys = $derived((data.apiKeys ?? []).slice(0, 3));
	// Karte nur mit Recht oder vorhandenen Schlüsseln (`[]` ist truthy und taugt nicht als Kriterium)
	const showKeys = $derived(data.permissions.includes('core.api.manage') || keys.length > 0);
</script>

<div class="space-y-6">
	<Card>
		<CardHeader
			><CardTitle class="font-semibold">{t('profile.security.password')}</CardTitle></CardHeader
		>
		<CardContent>
			{#if pwError}
				<Alert variant="destructive" class="mb-4"
					><AlertDescription role="alert">{pwError}</AlertDescription></Alert
				>
			{/if}
			<form
				method="POST"
				action="?/changePassword"
				class="grid max-w-2xl gap-4"
				use:enhance={submitter(
					(o) => {
						pwError = o.error;
					},
					{ setBusy: (b) => (pwBusy = b), reset: true }
				)}
			>
				<FormField label={t('profile.security.currentPassword')} id="currentPassword">
					<Input
						id="currentPassword"
						name="currentPassword"
						type="password"
						autocomplete="current-password"
						required
					/>
				</FormField>
				<FormField
					label={t('profile.security.newPassword')}
					id="newPassword"
					hint={t('profile.security.newPasswordHint')}
				>
					<Input
						id="newPassword"
						name="newPassword"
						type="password"
						autocomplete="new-password"
						minlength={12}
						required
					/>
				</FormField>
				<FormField label={t('profile.security.confirmPassword')} id="confirm">
					<Input
						id="confirm"
						name="confirm"
						type="password"
						autocomplete="new-password"
						minlength={12}
						required
					/>
				</FormField>
				<div class="flex items-center gap-2">
					<Checkbox
						id="revokeOthers"
						name="revokeOthers"
						bind:checked={revokeOthersOnChange}
						value="on"
					/>
					<Label for="revokeOthers" class="font-normal"
						>{t('profile.security.revokeOthersOnChange')}</Label
					>
				</div>
				<Button type="submit" class="w-fit" disabled={pwBusy}>
					{pwBusy ? t('profile.saving') : t('profile.security.changePassword')}
				</Button>
			</form>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle class="font-semibold">{t('profile.security.twoFactor')}</CardTitle>
			<CardDescription>
				{t('profile.security.twoFactorDescription')}
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-wrap items-center justify-between gap-3">
			<Badge variant={data.profile.twoFactorEnabled ? 'default' : 'secondary'}>
				{data.profile.twoFactorEnabled
					? t('profile.security.active')
					: t('profile.security.inactive')}
			</Badge>
			{#if data.profile.twoFactorEnabled}
				<Button
					variant="outline"
					onclick={() => {
						tfError = null;
						disableOpen = true;
					}}>{t('profile.security.disable')}</Button
				>
			{:else}
				<Button
					onclick={() => {
						tfError = null;
						setup = null;
						saved = false;
						enableOpen = true;
					}}>{t('profile.security.enable')}</Button
				>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<CardTitle class="font-semibold">{t('profile.security.sessions')}</CardTitle>
				{#if others.length > 0}
					<Button variant="outline" size="sm" onclick={() => (revokeAllOpen = true)}>
						{t('profile.security.revokeAllOthers')}
					</Button>
				{/if}
			</div>
		</CardHeader>
		<CardContent>
			{#if sessionError}
				<Alert variant="destructive" class="mb-4"
					><AlertDescription role="alert">{sessionError}</AlertDescription></Alert
				>
			{/if}
			<ul class="divide-y">
				{#each data.sessions as s (s.id)}
					{@const Icon = isMobile(s.userAgent) ? Smartphone : Monitor}
					<li class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
						<div class="flex min-w-0 items-center gap-3">
							<Icon class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
							<div class="min-w-0">
								<p class="flex flex-wrap items-center gap-2 font-medium">
									<span class="truncate" title={s.userAgent ?? undefined}>
										{describeUserAgent(s.userAgent)}
									</span>
									{#if s.current}<Badge>{t('profile.security.thisSession')}</Badge>{/if}
								</p>
								<p class="text-xs text-muted-foreground">
									{t('profile.security.sessionInfo', {
										ip: s.ipAddress ?? t('profile.security.ipUnknown'),
										date: dateTime.format(new Date(s.createdAt))
									})}
								</p>
							</div>
						</div>
						{#if !s.current}
							<Button variant="outline" size="sm" onclick={() => revokeOne(s.id)}
								>{t('profile.security.revoke')}</Button
							>
						{/if}
					</li>
				{/each}
			</ul>
		</CardContent>
	</Card>

	{#if showKeys}
		<Card>
			<CardHeader>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<CardTitle class="font-semibold">{t('profile.security.apiKeys')}</CardTitle>
					<a
						href="/admin/api"
						class="touch-link text-sm text-link underline-offset-4 hover:underline"
					>
						{t('profile.security.manageAll')}
					</a>
				</div>
			</CardHeader>
			<CardContent>
				{#if keys.length === 0}
					<EmptyState
						title={t('profile.security.noApiKeys')}
						description={t('profile.security.noApiKeysDescription')}
					/>
				{:else}
					<ul class="divide-y">
						{#each keys as k, i (k.id ?? `${k.prefix}-${i}`)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
								<div class="min-w-0">
									<p class="truncate font-medium">{k.name}</p>
									<p class="font-mono text-xs text-muted-foreground">{k.prefix}…</p>
								</div>
								<span class="text-xs text-muted-foreground">
									{k.lastUsedAt
										? t('profile.security.lastUsed', {
												date: dateOnly.format(new Date(k.lastUsedAt))
											})
										: t('profile.security.neverUsed')}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</CardContent>
		</Card>
	{/if}
</div>

<Dialog.Root bind:open={enableOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{t('profile.security.enableTitle')}</Dialog.Title>
			<Dialog.Description>
				{setup ? t('profile.security.enableScan') : t('profile.security.enableConfirmPassword')}
			</Dialog.Description>
		</Dialog.Header>

		{#if tfError}
			<Alert variant="destructive"
				><AlertDescription role="alert">{tfError}</AlertDescription></Alert
			>
		{/if}

		{#if !setup}
			<form
				method="POST"
				action="?/enable2fa"
				class="grid gap-4"
				use:enhance={submitter(
					(o) => {
						tfError = o.error;
						const s = o.data.setup as { qr: string; backupCodes: string[] } | undefined;
						if (o.ok && s) setup = s;
					},
					{ setBusy: (b) => (tfBusy = b), reload: false }
				)}
			>
				<FormField label={t('profile.security.password')} id="pw-enable">
					<Input
						id="pw-enable"
						name="password"
						type="password"
						autocomplete="current-password"
						required
					/>
				</FormField>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (enableOpen = false)}>
						{t('profile.cancel')}
					</Button>
					<Button type="submit" disabled={tfBusy}
						>{tfBusy ? t('profile.security.checking') : t('profile.security.next')}</Button
					>
				</Dialog.Footer>
			</form>
		{:else}
			<div class="grid gap-4">
				<img
					src={setup.qr}
					alt={t('profile.security.qrAlt')}
					class="mx-auto size-48 rounded border bg-white p-2"
				/>
				<div class="grid gap-2">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="text-sm font-medium">{t('profile.security.backupCodes')}</p>
						<Button type="button" variant="outline" size="sm" onclick={copyCodes}>
							<Copy />
							{t('profile.security.copyCodes')}
						</Button>
					</div>
					<ul class="grid grid-cols-2 gap-1 rounded border bg-muted p-3 font-mono text-xs">
						{#each setup.backupCodes as c (c)}<li>{c}</li>{/each}
					</ul>
					<p class="text-xs text-muted-foreground">
						{t('profile.security.backupCodesHint')}
					</p>
					<div class="flex items-center gap-2">
						<Checkbox id="codes-saved" bind:checked={saved} />
						<Label for="codes-saved" class="font-normal">{t('profile.security.codesSaved')}</Label>
					</div>
				</div>
				<form
					method="POST"
					action="?/verify2fa"
					class="grid gap-4"
					use:enhance={submitter(
						(o) => {
							if (o.ok) {
								enableOpen = false;
								setup = null;
							} else tfError = o.error;
						},
						{ setBusy: (b) => (tfBusy = b) }
					)}
				>
					<FormField label={t('profile.security.verificationCode')} id="tf-code">
						<Input
							id="tf-code"
							name="code"
							inputmode="numeric"
							autocomplete="one-time-code"
							required
						/>
					</FormField>
					<Dialog.Footer>
						<Button type="button" variant="outline" onclick={() => (enableOpen = false)}>
							{t('profile.cancel')}
						</Button>
						<Button type="submit" disabled={!saved || tfBusy}>
							{tfBusy ? t('profile.security.checking') : t('profile.security.finishEnable')}
						</Button>
					</Dialog.Footer>
				</form>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={disableOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{t('profile.security.disableTitle')}</Dialog.Title>
			<Dialog.Description>
				{t('profile.security.disableDescription')}
			</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/disable2fa"
			class="grid gap-4"
			use:enhance={submitter(
				(o) => {
					if (o.ok) disableOpen = false;
					else tfError = o.error;
				},
				{ setBusy: (b) => (tfBusy = b) }
			)}
		>
			{#if tfError}
				<Alert variant="destructive"
					><AlertDescription role="alert">{tfError}</AlertDescription></Alert
				>
			{/if}
			<FormField label={t('profile.security.password')} id="pw-disable">
				<Input
					id="pw-disable"
					name="password"
					type="password"
					autocomplete="current-password"
					required
				/>
			</FormField>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (disableOpen = false)}>
					{t('profile.cancel')}
				</Button>
				<Button type="submit" variant="destructive" disabled={tfBusy}>
					{tfBusy ? t('profile.security.disabling') : t('profile.security.disable')}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<ConfirmDialog
	bind:open={revokeAllOpen}
	title={t('profile.security.revokeAllTitle')}
	description={t('profile.security.revokeAllDescription')}
	confirmLabel={t('profile.security.revokeAllConfirm')}
	destructive
	onconfirm={revokeOthers}
/>
