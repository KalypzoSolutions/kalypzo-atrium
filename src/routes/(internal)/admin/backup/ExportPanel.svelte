<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import DatabaseBackup from '@lucide/svelte/icons/database-backup';
	import Download from '@lucide/svelte/icons/download';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import type { BackupScopeInfo, ExportResult } from '$lib/backup/contract';
	import { FormField } from '$lib/components/layout';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import AccountFields from './AccountFields.svelte';
	import { fmt, fmtBytes, impliedOf, passwordStrength, postJson } from './client';
	import ProgressBar from './ProgressBar.svelte';
	import ScopePicker from './ScopePicker.svelte';

	let {
		scopes,
		twoFactorEnabled,
		minPassword
	}: { scopes: BackupScopeInfo[]; twoFactorEnabled: boolean; minPassword: number } = $props();

	// Standard: alles ausgewählt
	// svelte-ignore state_referenced_locally
	let selected = $state<string[]>(scopes.map((s) => s.key));
	let includeFiles = $state(true);
	let backupPassword = $state('');
	let backupPassword2 = $state('');
	let password = $state('');
	let totp = $state('');

	let dialogOpen = $state(false);
	let busy = $state(false);
	let error = $state('');
	let fieldErrors = $state<Record<string, string>>({});
	let result = $state<ExportResult | null>(null);
	let downloaded = $state(false);

	const byKey = $derived(new Map(scopes.map((s) => [s.key, s])));
	const allScopes = $derived([...selected, ...impliedOf(selected, byKey).keys()]);
	const strength = $derived(passwordStrength(backupPassword));

	const pwError = $derived(
		backupPassword.length > 0 && backupPassword.length < minPassword
			? `Mindestens ${minPassword} Zeichen`
			: (fieldErrors.backupPassword ?? null)
	);
	const pw2Error = $derived(
		backupPassword2.length > 0 && backupPassword2 !== backupPassword
			? 'Die Passwörter stimmen nicht überein'
			: null
	);
	const canStart = $derived(
		allScopes.length > 0 &&
			backupPassword.length >= minPassword &&
			backupPassword === backupPassword2 &&
			!busy
	);
	const canSubmit = $derived(
		password.length > 0 && (!twoFactorEnabled || /^\d{6}$/.test(totp.trim())) && !busy
	);

	const strengthClass = $derived(
		strength.score <= 1
			? 'bg-destructive'
			: strength.score === 2
				? 'bg-amber-500'
				: 'bg-green-600 dark:bg-green-500'
	);

	function openDialog() {
		if (!canStart) return;
		password = '';
		totp = '';
		fieldErrors = {};
		error = '';
		dialogOpen = true;
	}

	function startDownload(r: ExportResult) {
		const a = document.createElement('a');
		a.href = `/admin/backup/export/${encodeURIComponent(r.downloadId)}`;
		a.download = r.fileName;
		document.body.appendChild(a);
		a.click();
		a.remove();
		downloaded = true;
	}

	async function create() {
		if (!canSubmit) return;
		busy = true;
		error = '';
		fieldErrors = {};
		dialogOpen = false;
		const r = await postJson<ExportResult>('/export', {
			scopes: allScopes,
			includeFiles,
			backupPassword,
			password,
			...(twoFactorEnabled ? { totp: totp.trim() } : {})
		});
		busy = false;
		password = '';
		totp = '';
		if (r.ok) {
			result = r.data;
			backupPassword = '';
			backupPassword2 = '';
			toast.success('Sicherung erstellt');
			startDownload(r.data);
			return;
		}
		fieldErrors = r.fields;
		if (r.fields.password || r.fields.totp) {
			// Konto-Bestätigung falsch → Dialog erneut öffnen, Fehler am Feld
			dialogOpen = true;
		} else {
			error = r.message;
			toast.error(r.message);
		}
	}

	function reset() {
		result = null;
		downloaded = false;
		error = '';
		fieldErrors = {};
	}
</script>

{#if result}
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2">
				<CircleCheck class="size-5 text-green-600 dark:text-green-500" aria-hidden="true" />
				Sicherung erstellt
			</Card.Title>
			<Card.Description>
				{result.fileName} – {result.summary.scopes.length}
				{result.summary.scopes.length === 1 ? 'Bereich' : 'Bereiche'}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="rounded-lg border p-3">
					<dt class="text-xs text-muted-foreground">Tabellen</dt>
					<dd class="text-2xl font-semibold tabular-nums">{fmt(result.summary.tables)}</dd>
				</div>
				<div class="rounded-lg border p-3">
					<dt class="text-xs text-muted-foreground">Datensätze</dt>
					<dd class="text-2xl font-semibold tabular-nums">{fmt(result.summary.rows)}</dd>
				</div>
				<div class="rounded-lg border p-3">
					<dt class="text-xs text-muted-foreground">Dateien</dt>
					<dd class="text-2xl font-semibold tabular-nums">{fmt(result.summary.files)}</dd>
				</div>
				<div class="rounded-lg border p-3">
					<dt class="text-xs text-muted-foreground">Größe</dt>
					<dd class="text-2xl font-semibold tabular-nums">{fmtBytes(result.summary.bytes)}</dd>
				</div>
			</dl>
			{#if result.summary.warnings.length}
				<Alert.Root>
					<TriangleAlert class="text-amber-600" aria-hidden="true" />
					<Alert.Title>Hinweise</Alert.Title>
					<Alert.Description>
						<ul class="list-disc space-y-1 pl-4">
							{#each result.summary.warnings as w, i (i)}<li>{w}</li>{/each}
						</ul>
					</Alert.Description>
				</Alert.Root>
			{/if}
			<p class="text-xs text-muted-foreground" role="status">
				{downloaded
					? 'Der Download wurde gestartet. Prüfe, ob die Datei vollständig gespeichert ist.'
					: 'Startet der Download nicht von selbst, nutze den Knopf.'}
				Der Link funktioniert nur einmal und 15 Minuten lang. Bewahre Datei und Sicherungs-Passwort getrennt
				und sicher auf.
			</p>
		</Card.Content>
		<Card.Footer class="flex flex-wrap justify-end gap-2">
			<Button variant="outline" onclick={reset}>Neue Sicherung</Button>
			<Button
				href="/admin/backup/export/{encodeURIComponent(result.downloadId)}"
				download={result.fileName}
				onclick={() => (downloaded = true)}
			>
				<Download aria-hidden="true" />
				Herunterladen
			</Button>
		</Card.Footer>
	</Card.Root>
{:else}
	<div class="space-y-6">
		<Card.Root>
			<Card.Header>
				<Card.Title>Bereiche</Card.Title>
				<Card.Description>
					Wähle aus, was gesichert werden soll. Abhängige Bereiche gehen automatisch mit.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-5">
				<ScopePicker {scopes} bind:selected disabled={busy} />
				<div class="flex items-start gap-3 rounded-md border p-3">
					<Checkbox
						id="export-files"
						class="mt-0.5"
						bind:checked={includeFiles}
						disabled={busy}
						aria-describedby="export-files-desc"
					/>
					<div class="space-y-1">
						<Label for="export-files" class="font-medium">Dateien einschließen</Label>
						<p id="export-files-desc" class="text-xs text-muted-foreground">
							Hochgeladene Dateien (Belege, Bilder, Dokumente) der gewählten Bereiche. Ohne Dateien
							ist die Sicherung kleiner, beim Wiederherstellen fehlen dann aber die Inhalte.
						</p>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Sicherungs-Passwort</Card.Title>
				<Card.Description
					>Die Sicherungsdatei wird mit diesem Passwort verschlüsselt.</Card.Description
				>
			</Card.Header>
			<Card.Content class="space-y-4">
				<Alert.Root>
					<TriangleAlert class="text-amber-600" aria-hidden="true" />
					<Alert.Title>Gut aufbewahren</Alert.Title>
					<Alert.Description>
						Ohne dieses Passwort lässt sich die Sicherung nicht wiederherstellen. Datei + Passwort
						geben Zugriff auf alle Daten inkl. Zugangsdaten.
					</Alert.Description>
				</Alert.Root>
				<form
					class="grid grid-cols-1 items-start gap-4 sm:grid-cols-2"
					onsubmit={(e) => {
						e.preventDefault();
						openDialog();
					}}
				>
					<div class="grid content-start gap-2">
						<FormField
							label="Sicherungs-Passwort *"
							id="export-backup-password"
							error={pwError}
							hint="Mindestens {minPassword} Zeichen"
						>
							<Input
								id="export-backup-password"
								type="password"
								autocomplete="new-password"
								bind:value={backupPassword}
								disabled={busy}
								required
								aria-invalid={pwError ? true : undefined}
								aria-describedby={pwError
									? 'export-backup-password-error'
									: 'export-backup-password-hint export-strength'}
							/>
						</FormField>
						{#if backupPassword}
							<div class="flex items-center gap-2" id="export-strength">
								<div class="flex flex-1 gap-1" aria-hidden="true">
									{#each [0, 1, 2, 3] as i (i)}
										<span
											class="h-1 flex-1 rounded-full {i < strength.score
												? strengthClass
												: 'bg-muted'}"
										></span>
									{/each}
								</div>
								<span class="text-xs text-muted-foreground">Stärke: {strength.label}</span>
							</div>
						{/if}
					</div>
					<FormField label="Passwort wiederholen *" id="export-backup-password2" error={pw2Error}>
						<Input
							id="export-backup-password2"
							type="password"
							autocomplete="new-password"
							bind:value={backupPassword2}
							disabled={busy}
							required
							aria-invalid={pw2Error ? true : undefined}
							aria-describedby={pw2Error ? 'export-backup-password2-error' : undefined}
						/>
					</FormField>
				</form>
			</Card.Content>
		</Card.Root>

		{#if busy}
			<div class="space-y-2 rounded-md border p-4" role="status" aria-live="polite">
				<p class="text-sm font-medium">Sicherung wird erstellt …</p>
				<ProgressBar value={0} indeterminate label="Sicherung wird erstellt" />
				<p class="text-xs text-muted-foreground">
					Das kann bei vielen Dateien einige Minuten dauern. Bitte lass die Seite geöffnet.
				</p>
			</div>
		{/if}
		{#if error}
			<p class="text-sm text-destructive" role="alert">{error}</p>
		{/if}

		<div class="flex flex-wrap items-center justify-end gap-3">
			{#if !allScopes.length}
				<p class="text-xs text-muted-foreground">Bitte mindestens einen Bereich wählen.</p>
			{/if}
			<Button onclick={openDialog} disabled={!canStart}>
				<DatabaseBackup aria-hidden="true" />
				{busy ? 'Sicherung läuft …' : 'Sicherung erstellen'}
			</Button>
		</div>
	</div>
{/if}

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Sicherung bestätigen</Dialog.Title>
			<Dialog.Description>
				Bestätige mit deinem Konto-Passwort{twoFactorEnabled
					? ' und dem Code deiner Authenticator-App'
					: ''}. Gesichert werden {allScopes.length}
				{allScopes.length === 1 ? 'Bereich' : 'Bereiche'}{includeFiles
					? ' inklusive Dateien'
					: ' ohne Dateien'}.
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="grid gap-4"
			onsubmit={(e) => {
				e.preventDefault();
				void create();
			}}
		>
			<AccountFields
				idPrefix="export"
				bind:password
				bind:totp
				{twoFactorEnabled}
				disabled={busy}
				errors={fieldErrors}
			/>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (dialogOpen = false)}>
					Abbrechen
				</Button>
				<Button type="submit" disabled={!canSubmit}>
					{busy ? 'Sicherung läuft …' : 'Sicherung erstellen'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
