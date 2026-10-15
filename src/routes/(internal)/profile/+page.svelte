<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { FormField, PageHeader } from '$lib/components/layout';
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
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { SelectField } from '$lib/components/ui/select-field';
	import { theme } from '$lib/theme.svelte';

	let { data, form } = $props();
	let busy = $state<string | null>(null);
	let themeOverride = $state<string | null>(null);
	const themeValue = $derived(themeOverride ?? data.settings.theme);

	const fmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
	const setup = $derived(form && 'setup' in form ? form.setup : null);
	const err = (s: string) => (form && form.section === s && 'error' in form ? form.error : null);

	function submit(section: string, after?: () => void) {
		return () => {
			busy = section;
			return async ({
				result,
				update
			}: {
				result: { type: string; data?: Record<string, unknown> };
				update: (o?: { reset?: boolean }) => Promise<void>;
			}) => {
				busy = null;
				if (result.type === 'success' && typeof result.data?.success === 'string') {
					toast.success(result.data.success);
					after?.();
				}
				await update({ reset: section === 'password' });
			};
		};
	}
</script>

<svelte:head><title>Profil - {data.systemName}</title></svelte:head>

<PageHeader title="Profil" description="Konto, Sicherheit und persoenliche Einstellungen." />

<div class="grid gap-6">
	<Card>
		<CardHeader><CardTitle class="text-base">Konto</CardTitle></CardHeader>
		<CardContent class="grid gap-1 text-sm">
			<p><span class="text-muted-foreground">Name:</span> {data.profile.name}</p>
			<p><span class="text-muted-foreground">E-Mail:</span> {data.profile.email}</p>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle class="text-base">Passwort aendern</CardTitle>
		</CardHeader>
		<CardContent>
			{#if err('password')}
				<Alert variant="destructive" class="mb-4"
					><AlertDescription role="alert">{err('password')}</AlertDescription></Alert
				>
			{/if}
			<form
				method="POST"
				action="?/changePassword"
				class="grid max-w-md gap-4"
				use:enhance={submit('password')}
			>
				<FormField label="Aktuelles Passwort" id="currentPassword">
					<Input
						id="currentPassword"
						name="currentPassword"
						type="password"
						autocomplete="current-password"
						required
					/>
				</FormField>
				<FormField label="Neues Passwort" id="newPassword" hint="Mindestens 12 Zeichen">
					<Input
						id="newPassword"
						name="newPassword"
						type="password"
						autocomplete="new-password"
						minlength={12}
						required
					/>
				</FormField>
				<FormField label="Neues Passwort bestaetigen" id="confirm">
					<Input
						id="confirm"
						name="confirm"
						type="password"
						autocomplete="new-password"
						minlength={12}
						required
					/>
				</FormField>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" name="revokeOthers" checked class="size-4" />
					Alle anderen Sessions beenden
				</label>
				<Button type="submit" class="w-fit" disabled={busy === 'password'}>Passwort aendern</Button>
			</form>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle class="text-base">Zwei-Faktor-Authentifizierung</CardTitle>
			<CardDescription>
				Status:
				<Badge variant={data.profile.twoFactorEnabled ? 'default' : 'secondary'}>
					{data.profile.twoFactorEnabled ? 'Aktiv' : 'Inaktiv'}
				</Badge>
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if err('2fa')}
				<Alert variant="destructive" class="mb-4"
					><AlertDescription role="alert">{err('2fa')}</AlertDescription></Alert
				>
			{/if}

			{#if setup}
				<div class="grid max-w-md gap-4">
					<p class="text-sm">
						Scannen Sie den QR-Code mit Ihrer Authenticator-App und bestaetigen Sie mit dem
						angezeigten Code.
					</p>
					<img
						src={setup.qr}
						alt="QR-Code fuer die Authenticator-App"
						class="size-48 rounded border bg-white p-2"
					/>
					<div>
						<p class="mb-1 text-sm font-medium">
							Backup-Codes (einmalig angezeigt, sicher aufbewahren)
						</p>
						<ul class="grid grid-cols-2 gap-1 rounded border bg-muted p-3 font-mono text-xs">
							{#each setup.backupCodes as c (c)}<li>{c}</li>{/each}
						</ul>
					</div>
					<form method="POST" action="?/verify2fa" class="grid gap-3" use:enhance={submit('2fa')}>
						<FormField label="Bestaetigungscode" id="code">
							<Input
								id="code"
								name="code"
								inputmode="numeric"
								autocomplete="one-time-code"
								required
							/>
						</FormField>
						<Button type="submit" class="w-fit" disabled={busy === '2fa'}
							>Aktivierung abschliessen</Button
						>
					</form>
				</div>
			{:else if data.profile.twoFactorEnabled}
				<form
					method="POST"
					action="?/disable2fa"
					class="grid max-w-md gap-3"
					use:enhance={submit('2fa')}
				>
					<FormField label="Passwort zur Bestaetigung" id="pw-disable">
						<Input
							id="pw-disable"
							name="password"
							type="password"
							autocomplete="current-password"
							required
						/>
					</FormField>
					<Button type="submit" variant="destructive" class="w-fit" disabled={busy === '2fa'}>
						2FA deaktivieren
					</Button>
				</form>
			{:else}
				<form
					method="POST"
					action="?/enable2fa"
					class="grid max-w-md gap-3"
					use:enhance={submit('2fa')}
				>
					<FormField label="Passwort zur Bestaetigung" id="pw-enable">
						<Input
							id="pw-enable"
							name="password"
							type="password"
							autocomplete="current-password"
							required
						/>
					</FormField>
					<Button type="submit" class="w-fit" disabled={busy === '2fa'}>2FA einrichten</Button>
				</form>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle class="text-base">Aktive Sessions</CardTitle>
		</CardHeader>
		<CardContent>
			{#if err('sessions')}
				<Alert variant="destructive" class="mb-4"
					><AlertDescription role="alert">{err('sessions')}</AlertDescription></Alert
				>
			{/if}
			<ul class="divide-y">
				{#each data.sessions as s (s.id)}
					<li class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
						<div class="min-w-0">
							<p class="truncate font-medium">
								{s.userAgent ?? 'Unbekanntes Geraet'}
								{#if s.current}<Badge class="ml-2">Diese Session</Badge>{/if}
							</p>
							<p class="text-xs text-muted-foreground">
								{s.ipAddress ?? 'IP unbekannt'} · angemeldet {fmt.format(new Date(s.createdAt))}
							</p>
						</div>
						{#if !s.current}
							<form method="POST" action="?/revokeSession" use:enhance={submit('sessions')}>
								<input type="hidden" name="id" value={s.id} />
								<Button type="submit" variant="outline" size="sm">Beenden</Button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		</CardContent>
	</Card>

	<Card>
		<CardHeader><CardTitle class="text-base">Persoenliche Einstellungen</CardTitle></CardHeader>
		<CardContent>
			{#if err('settings')}
				<Alert variant="destructive" class="mb-4"
					><AlertDescription role="alert">{err('settings')}</AlertDescription></Alert
				>
			{/if}
			<form
				method="POST"
				action="?/saveSettings"
				class="grid max-w-md gap-4"
				use:enhance={submit('settings', () => {
					const sel = document.getElementById('theme') as HTMLSelectElement | null;
					if (sel) theme.set(sel.value as 'light' | 'dark' | 'system');
				})}
			>
				<div class="grid gap-1.5">
					<Label for="theme">Darstellung</Label>
					<SelectField
						id="theme"
						name="theme"
						label="Darstellung"
						options={[
							{ value: 'system', label: 'System' },
							{ value: 'light', label: 'Hell' },
							{ value: 'dark', label: 'Dunkel' }
						]}
						bind:value={() => themeValue, (v) => (themeOverride = v)}
					/>
				</div>
				<FormField label="Eintraege pro Seite" id="pageSize">
					<Input
						id="pageSize"
						name="pageSize"
						type="number"
						min="10"
						max="200"
						value={data.settings.pageSize}
					/>
				</FormField>
				<Button type="submit" class="w-fit" disabled={busy === 'settings'}>Speichern</Button>
			</form>
		</CardContent>
	</Card>
</div>
