<script lang="ts">
	import { t } from '$lib/i18n';
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
			? t('admin-backup.export.minChars', { count: minPassword })
			: (fieldErrors.backupPassword ?? null)
	);
	const pw2Error = $derived(
		backupPassword2.length > 0 && backupPassword2 !== backupPassword
			? t('admin-backup.export.mismatch')
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
		strength.score <= 1 ? 'bg-destructive' : strength.score === 2 ? 'bg-warning' : 'bg-success'
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
			toast.success(t('admin-backup.export.created'));
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
				<CircleCheck class="size-5 text-success" aria-hidden="true" />
				{t('admin-backup.export.created')}
			</Card.Title>
			<Card.Description>
				{t('admin-backup.export.resultSummary', {
					file: result.fileName,
					count: result.summary.scopes.length
				})}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="rounded-lg border p-3">
					<dt class="text-xs text-muted-foreground">{t('admin-backup.export.tables')}</dt>
					<dd class="text-2xl font-semibold tabular-nums">{fmt(result.summary.tables)}</dd>
				</div>
				<div class="rounded-lg border p-3">
					<dt class="text-xs text-muted-foreground">{t('admin-backup.export.rows')}</dt>
					<dd class="text-2xl font-semibold tabular-nums">{fmt(result.summary.rows)}</dd>
				</div>
				<div class="rounded-lg border p-3">
					<dt class="text-xs text-muted-foreground">{t('admin-backup.export.files')}</dt>
					<dd class="text-2xl font-semibold tabular-nums">{fmt(result.summary.files)}</dd>
				</div>
				<div class="rounded-lg border p-3">
					<dt class="text-xs text-muted-foreground">{t('admin-backup.export.size')}</dt>
					<dd class="text-2xl font-semibold tabular-nums">{fmtBytes(result.summary.bytes)}</dd>
				</div>
			</dl>
			{#if result.summary.warnings.length}
				<Alert.Root variant="warning">
					<TriangleAlert aria-hidden="true" />
					<Alert.Title>{t('admin-backup.export.warnings')}</Alert.Title>
					<Alert.Description>
						<ul class="list-disc space-y-1 pl-4">
							{#each result.summary.warnings as w, i (i)}<li>{w}</li>{/each}
						</ul>
					</Alert.Description>
				</Alert.Root>
			{/if}
			<p class="text-xs text-muted-foreground" role="status">
				{downloaded
					? t('admin-backup.export.downloadStarted')
					: t('admin-backup.export.downloadManual')}
				{t('admin-backup.export.linkOnce')}
			</p>
		</Card.Content>
		<Card.Footer class="flex flex-wrap justify-end gap-2">
			<Button variant="outline" onclick={reset}>{t('admin-backup.export.newBackup')}</Button>
			<Button
				href="/admin/backup/export/{encodeURIComponent(result.downloadId)}"
				download={result.fileName}
				onclick={() => (downloaded = true)}
			>
				<Download aria-hidden="true" />
				{t('admin-backup.export.download')}
			</Button>
		</Card.Footer>
	</Card.Root>
{:else}
	<div class="space-y-6">
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('admin-backup.export.scopesTitle')}</Card.Title>
				<Card.Description>
					{t('admin-backup.export.scopesDescription')}
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
						<Label for="export-files" class="font-medium"
							>{t('admin-backup.export.includeFiles')}</Label
						>
						<p id="export-files-desc" class="text-xs text-muted-foreground">
							{t('admin-backup.export.includeFilesHint')}
						</p>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>{t('admin-backup.export.passwordTitle')}</Card.Title>
				<Card.Description>{t('admin-backup.export.passwordDescription')}</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<Alert.Root variant="warning">
					<TriangleAlert aria-hidden="true" />
					<Alert.Title>{t('admin-backup.export.keepSafe')}</Alert.Title>
					<Alert.Description>
						{t('admin-backup.export.keepSafeText')}
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
							label={t('admin-backup.export.passwordLabel')}
							id="export-backup-password"
							error={pwError}
							hint={t('admin-backup.export.minChars', { count: minPassword })}
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
								<span class="text-xs text-muted-foreground"
									>{t('admin-backup.export.strength', { label: strength.label })}</span
								>
							</div>
						{/if}
					</div>
					<FormField
						label={t('admin-backup.export.passwordRepeat')}
						id="export-backup-password2"
						error={pw2Error}
					>
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
				<p class="text-sm font-medium">{t('admin-backup.export.creating')}</p>
				<ProgressBar value={0} indeterminate label={t('admin-backup.export.creatingLabel')} />
				<p class="text-xs text-muted-foreground">
					{t('admin-backup.export.creatingHint')}
				</p>
			</div>
		{/if}
		{#if error}
			<p class="text-sm text-destructive" role="alert">{error}</p>
		{/if}

		<div class="flex flex-wrap items-center justify-end gap-3">
			{#if !allScopes.length}
				<p class="text-xs text-muted-foreground">{t('admin-backup.export.chooseScope')}</p>
			{/if}
			<Button onclick={openDialog} disabled={!canStart}>
				<DatabaseBackup aria-hidden="true" />
				{busy ? t('admin-backup.export.running') : t('admin-backup.export.create')}
			</Button>
		</div>
	</div>
{/if}

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{t('admin-backup.export.confirmTitle')}</Dialog.Title>
			<Dialog.Description>
				{t('admin-backup.export.confirmDescription', {
					twoFactor: twoFactorEnabled ? 'yes' : 'no',
					count: allScopes.length,
					files: includeFiles ? 'yes' : 'no'
				})}
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
					{t('admin-backup.export.cancel')}
				</Button>
				<Button type="submit" disabled={!canSubmit}>
					{busy ? t('admin-backup.export.running') : t('admin-backup.export.create')}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
