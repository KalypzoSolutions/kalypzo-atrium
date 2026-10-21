<!--
	Import-Assistent: 1 Datei hochladen → 2 Passwörter → 3 Vorschau/Optionen → 4 Bestätigen → Lauf → Ergebnis.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import Info from '@lucide/svelte/icons/info';
	import Lock from '@lucide/svelte/icons/lock';
	import LogIn from '@lucide/svelte/icons/log-in';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Upload from '@lucide/svelte/icons/upload';
	import { toast } from 'svelte-sonner';
	import type {
		BackupScopeInfo,
		RestoreMode,
		RestorePreview,
		RunStatus,
		UploadCreated,
		UploadProgress
	} from '$lib/backup/contract';
	import { ConfirmDialog, FileField, FormField } from '$lib/components/layout';
	import TypedConfirmField from '$lib/components/layout/TypedConfirmField.svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import AccountFields from './AccountFields.svelte';
	import {
		fmt,
		fmtBytes,
		fmtDateTime,
		getJson,
		impliedOf,
		percent,
		postJson,
		putChunk
	} from './client';
	import ProgressBar from './ProgressBar.svelte';

	let {
		scopes,
		twoFactorEnabled,
		constants
	}: {
		/** Bereiche dieses Servers (für Abhängigkeiten) */
		scopes: BackupScopeInfo[];
		twoFactorEnabled: boolean;
		constants: { chunkBytes: number; fileExt: string; restoreWord: string; mergeWord: string };
	} = $props();

	const STEPS = ['Datei wählen', 'Passwörter', 'Vorschau', 'Bestätigen'] as const;
	const MODES: { value: RestoreMode; title: string; text: string }[] = [
		{
			value: 'restore',
			title: 'Wiederherstellen (ersetzt die gewählten Bereiche)',
			text: 'Die gewählten Bereiche werden vollständig durch den Stand der Sicherung ersetzt.'
		},
		{
			value: 'merge',
			title: 'Zusammenführen (ergänzt nur Fehlendes)',
			text: 'Nur fehlende Datensätze werden ergänzt. Vorhandene Daten bleiben unverändert.'
		}
	];

	type Phase = 'wizard' | 'running' | 'done' | 'failed' | 'loggedOut';

	let phase = $state<Phase>('wizard');
	let step = $state(1);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	// Schritt 1
	let file = $state<File | null>(null);
	let uploadId = $state<string | null>(null);
	let uploaded = $state(0);
	let uploadTotal = $state(0);
	let cancelUpload = false;

	// Schritt 2
	let backupPassword = $state('');
	let password = $state('');
	let totp = $state('');
	let fieldErrors = $state<Record<string, string>>({});

	// Schritt 3
	let preview = $state<RestorePreview | null>(null);
	let mode = $state<RestoreMode>('restore');
	let chosen = $state<string[]>([]);
	let takeSmtp = $state(false);
	let applyModuleState = $state(true);

	// Schritt 4 + Lauf
	let confirmValue = $state('');
	let confirmed = $state(false);
	let dialogOpen = $state(false);
	let run = $state<RunStatus | null>(null);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let pollFailures = 0;

	onDestroy(() => {
		cancelUpload = true;
		if (pollTimer) clearTimeout(pollTimer);
	});

	const localScopes = $derived(new Map(scopes.map((s) => [s.key, s])));
	const previewScopes = $derived(new Map((preview?.scopes ?? []).map((s) => [s.key, s])));
	const available = $derived((preview?.scopes ?? []).filter((s) => s.available).map((s) => s.key));

	/** Abhängigkeiten nach den Regeln dieses Servers, beschränkt auf verfügbare Bereiche */
	const implied = $derived.by(() => {
		const all = impliedOf(chosen, localScopes);
		for (const key of [...all.keys()]) if (!available.includes(key)) all.delete(key);
		return all;
	});
	const allChosen = $derived([...chosen, ...implied.keys()]);
	const word = $derived(mode === 'restore' ? constants.restoreWord : constants.mergeWord);
	const usersChosen = $derived(allChosen.includes('core:users'));

	const labelOf = (key: string) =>
		previewScopes.get(key)?.label ?? localScopes.get(key)?.label ?? key;
	const cid = (key: string) => `restore-scope-${key.replace(/[^a-z0-9-]/gi, '-')}`;

	function toggle(key: string, on: boolean) {
		chosen = on ? [...new Set([...chosen, key])] : chosen.filter((k) => k !== key);
	}

	function restart(toStep: 1 | 2 = 1) {
		step = toStep;
		phase = 'wizard';
		preview = null;
		confirmValue = '';
		error = '';
		fieldErrors = {};
		run = null;
		if (toStep === 1) {
			file = null;
			uploadId = null;
			uploaded = 0;
			uploadTotal = 0;
			backupPassword = '';
			notice = '';
		}
		password = '';
		totp = '';
	}

	// ---------------------------------------------------------------------------
	// Schritt 1: Upload in Stücken
	// ---------------------------------------------------------------------------

	const fileOk = $derived(!!file && file.name.toLowerCase().endsWith(constants.fileExt));

	async function upload() {
		if (!file || !fileOk || busy) return;
		busy = true;
		error = '';
		notice = '';
		cancelUpload = false;
		uploaded = 0;
		uploadTotal = file.size;
		try {
			const created = await postJson<UploadCreated>('/import/upload', {
				size: file.size,
				fileName: file.name.slice(0, 200)
			});
			if (!created.ok) {
				error = created.message;
				toast.error(created.message);
				return;
			}
			const id = created.data.uploadId;
			const chunk = Math.max(
				1,
				Math.min(created.data.chunkBytes || constants.chunkBytes, constants.chunkBytes)
			);
			let offset = 0;
			let complete = false;
			while (offset < file.size) {
				if (cancelUpload) {
					error = 'Upload abgebrochen';
					return;
				}
				const part = file.slice(offset, Math.min(offset + chunk, file.size));
				const r = await putChunk<UploadProgress>(
					`/import/upload/${encodeURIComponent(id)}?offset=${offset}`,
					part
				);
				if (!r.ok) {
					error = r.message;
					toast.error(r.message);
					return;
				}
				offset = r.data.received;
				uploaded = r.data.received;
				complete = r.data.complete;
			}
			if (!complete) {
				error = 'Der Upload ist unvollständig. Bitte versuche es erneut.';
				return;
			}
			uploadId = id;
			step = 2;
		} finally {
			busy = false;
		}
	}

	// ---------------------------------------------------------------------------
	// Schritt 2: Prüfen
	// ---------------------------------------------------------------------------

	const canAnalyze = $derived(
		!!uploadId &&
			backupPassword.length > 0 &&
			password.length > 0 &&
			(!twoFactorEnabled || /^\d{6}$/.test(totp.trim())) &&
			!busy
	);

	async function analyze() {
		if (!canAnalyze || !uploadId) return;
		busy = true;
		error = '';
		fieldErrors = {};
		try {
			const r = await postJson<RestorePreview>('/import/analyze', {
				uploadId,
				backupPassword,
				password,
				...(twoFactorEnabled ? { totp: totp.trim() } : {})
			});
			if (!r.ok) {
				if (r.status === 404 || r.status === 409) {
					restart(1);
					notice = `${r.message} – bitte lade die Datei erneut hoch.`;
					return;
				}
				fieldErrors = r.fields;
				if (!Object.keys(r.fields).length) {
					error = r.message;
					toast.error(r.message);
				}
				return;
			}
			preview = r.data;
			mode = 'restore';
			chosen = r.data.scopes.filter((s) => s.available).map((s) => s.key);
			takeSmtp = false;
			applyModuleState = true;
			confirmValue = '';
			password = '';
			totp = '';
			step = 3;
		} finally {
			busy = false;
		}
	}

	// ---------------------------------------------------------------------------
	// Schritt 4: Ausführen + Status
	// ---------------------------------------------------------------------------

	const summary = $derived(
		mode === 'restore'
			? `${allChosen.length} ${allChosen.length === 1 ? 'Bereich wird' : 'Bereiche werden'} durch den Stand der Sicherung ersetzt. ` +
					'Aktuelle Daten dieser Bereiche gehen dabei verloren.'
			: `Aus der Sicherung werden in ${allChosen.length} ${allChosen.length === 1 ? 'Bereich' : 'Bereichen'} nur fehlende Datensätze ergänzt. ` +
					'Vorhandene Daten bleiben unverändert.'
	);

	async function execute() {
		if (!preview || !confirmed || busy) return;
		busy = true;
		error = '';
		try {
			const r = await postJson<{ runId: string }>('/import/execute', {
				token: preview.token,
				mode,
				scopes: allChosen,
				takeSmtp,
				applyModuleState: mode === 'restore' ? applyModuleState : false,
				confirmWord: confirmValue
			});
			if (!r.ok) {
				if (r.status === 409 || r.status === 404) {
					restart(2);
					notice = `${r.message} – bitte prüfe die Sicherung erneut.`;
					return;
				}
				error = r.message;
				toast.error(r.message);
				return;
			}
			run = {
				runId: r.data.runId,
				state: 'running',
				phase: 'Wird gestartet …',
				progress: { done: 0, total: 0 }
			};
			phase = 'running';
			pollFailures = 0;
			schedulePoll(r.data.runId);
		} finally {
			busy = false;
		}
	}

	function schedulePoll(runId: string) {
		pollTimer = setTimeout(() => void poll(runId), 1000);
	}

	async function poll(runId: string) {
		const r = await getJson<RunStatus>(`/import/status/${encodeURIComponent(runId)}`);
		if (!r.ok) {
			// Sitzung durch die Wiederherstellung beendet → neu anmelden
			if (r.status === 401) {
				phase = 'loggedOut';
				return;
			}
			// kurzzeitig nicht erreichbar (Wartung) → weiter versuchen
			if (++pollFailures < 60) return schedulePoll(runId);
			phase = 'failed';
			error = r.message;
			return;
		}
		pollFailures = 0;
		run = r.data;
		if (r.data.state === 'running') return schedulePoll(runId);
		if (r.data.state === 'done') {
			phase = r.data.result?.loggedOut ? 'loggedOut' : 'done';
			toast.success('Wiederherstellung abgeschlossen');
		} else {
			phase = 'failed';
			error = r.data.error ?? 'Die Wiederherstellung ist fehlgeschlagen.';
		}
	}

	const skippedRows = $derived(
		Object.entries(run?.result?.skipped ?? {})
			.filter(([, n]) => n > 0)
			.sort((a, b) => b[1] - a[1])
	);
	const skippedSum = $derived(skippedRows.reduce((s, [, n]) => s + n, 0));
</script>

{#if phase === 'running' && run}
	<Card.Root>
		<Card.Header>
			<Card.Title>Wiederherstellung läuft …</Card.Title>
			<Card.Description>
				Bitte schließe die Seite nicht. Das System ist währenddessen kurz nicht nutzbar.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-2" aria-live="polite">
			<p class="text-sm font-medium">{run.phase}</p>
			<ProgressBar
				value={percent(run.progress.done, run.progress.total)}
				indeterminate={run.progress.total === 0}
				label="Fortschritt der Wiederherstellung"
			/>
			{#if run.progress.total > 0}
				<p class="text-xs text-muted-foreground tabular-nums">
					{fmt(run.progress.done)} von {fmt(run.progress.total)}
				</p>
			{/if}
		</Card.Content>
	</Card.Root>
{:else if phase === 'loggedOut'}
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2">
				<CircleCheck class="size-5 text-success" aria-hidden="true" />
				Wiederherstellung abgeschlossen
			</Card.Title>
			<Card.Description>
				Deine Sitzung wurde dabei beendet. Melde dich neu an – mit den Zugangsdaten aus der
				Sicherung, falls dein Konto daraus übernommen wurde.
			</Card.Description>
		</Card.Header>
		<Card.Footer class="flex justify-end">
			<Button href="/login"><LogIn aria-hidden="true" />Neu anmelden</Button>
		</Card.Footer>
	</Card.Root>
{:else if phase === 'done' && run?.result}
	{@const res = run.result}
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2">
				<CircleCheck class="size-5 text-success" aria-hidden="true" />
				{res.mode === 'restore' ? 'Wiederherstellung' : 'Zusammenführung'} abgeschlossen
			</Card.Title>
			<Card.Description>
				{res.scopes.length}
				{res.scopes.length === 1 ? 'Bereich wurde' : 'Bereiche wurden'} übernommen.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="rounded-lg border p-3">
					<dt class="text-xs text-muted-foreground">Eingefügt</dt>
					<dd class="text-2xl font-semibold tabular-nums">{fmt(res.inserted)}</dd>
				</div>
				<div class="rounded-lg border p-3">
					<dt class="text-xs text-muted-foreground">Gelöscht</dt>
					<dd class="text-2xl font-semibold tabular-nums">{fmt(res.deleted)}</dd>
				</div>
				<div class="rounded-lg border p-3">
					<dt class="text-xs text-muted-foreground">Übersprungen</dt>
					<dd class="text-2xl font-semibold tabular-nums">{fmt(skippedSum)}</dd>
				</div>
				<div class="rounded-lg border p-3">
					<dt class="text-xs text-muted-foreground">Dateien</dt>
					<dd class="text-2xl font-semibold tabular-nums">{fmt(res.files.uploaded)}</dd>
				</div>
			</dl>
			<ul class="flex flex-wrap gap-1.5">
				{#each res.scopes as key (key)}
					<li><Badge variant="secondary">{labelOf(key)}</Badge></li>
				{/each}
			</ul>
			<ul class="space-y-1 text-sm text-muted-foreground">
				<li>
					Dateien: {fmt(res.files.uploaded)} übernommen, {fmt(res.files.skipped)} übersprungen{res
						.files.failed
						? `, ${fmt(res.files.failed)} fehlgeschlagen`
						: ''}
				</li>
				<li>
					Prüfwerte neu berechnet: {fmt(res.rehash.updated)}{res.rehash.unrecoverable
						? `, nicht wiederherstellbar: ${fmt(res.rehash.unrecoverable)}`
						: ''}
				</li>
			</ul>
			{#if skippedRows.length}
				<details class="group rounded-md border">
					<summary class="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
						<ChevronRight
							class="size-4 transition-transform group-open:rotate-90"
							aria-hidden="true"
						/>
						Übersprungene Datensätze je Tabelle ({fmt(skippedSum)})
					</summary>
					<div class="overflow-x-auto border-t">
						<Table.Root>
							<Table.Body>
								{#each skippedRows as [table, n] (table)}
									<Table.Row>
										<Table.Cell><code class="text-xs">{table}</code></Table.Cell>
										<Table.Cell class="text-right tabular-nums">{fmt(n)}</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				</details>
			{/if}
			{#if res.warnings.length}
				<Alert.Root variant="warning">
					<TriangleAlert aria-hidden="true" />
					<Alert.Title>Hinweise</Alert.Title>
					<Alert.Description>
						<ul class="list-disc space-y-1 pl-4">
							{#each res.warnings as w, i (i)}<li>{w}</li>{/each}
						</ul>
					</Alert.Description>
				</Alert.Root>
			{/if}
		</Card.Content>
		<Card.Footer class="flex flex-wrap justify-end gap-2">
			<Button variant="outline" href="/dashboard">Zum Dashboard</Button>
			<Button onclick={() => restart(1)}>Weitere Sicherung einspielen</Button>
		</Card.Footer>
	</Card.Root>
{:else if phase === 'failed'}
	<Alert.Root variant="destructive">
		<CircleX aria-hidden="true" />
		<Alert.Title>Wiederherstellung fehlgeschlagen</Alert.Title>
		<Alert.Description class="space-y-2">
			<p>{error || 'Unbekannter Fehler.'}</p>
			<p>Die Änderungen wurden zurückgerollt, soweit der Server das melden konnte.</p>
			<Button size="sm" variant="outline" onclick={() => restart(1)}>Neu beginnen</Button>
		</Alert.Description>
	</Alert.Root>
{:else}
	<div class="space-y-6">
		<Alert.Root>
			<Info aria-hidden="true" />
			<Alert.Title>Wiederherstellen am besten zu einem ruhigen Zeitpunkt.</Alert.Title>
			<Alert.Description>
				Hintergrundjobs pausieren während des Laufs. Was andere in dieser Zeit ändern, kann durch
				den Stand der Sicherung ersetzt werden.
			</Alert.Description>
		</Alert.Root>

		<ol class="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Schritte">
			{#each STEPS as label, i (label)}
				{@const n = i + 1}
				<li
					class="flex items-center gap-2 {n === step
						? 'font-semibold text-foreground'
						: 'text-muted-foreground'}"
					aria-current={n === step ? 'step' : undefined}
				>
					<span
						class="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums {n <
						step
							? 'border-primary bg-primary text-primary-foreground'
							: n === step
								? 'border-primary text-link'
								: ''}"
					>
						{n}
					</span>
					{label}
				</li>
			{/each}
		</ol>

		{#if notice}
			<Alert.Root variant="warning">
				<TriangleAlert aria-hidden="true" />
				<Alert.Description>{notice}</Alert.Description>
			</Alert.Root>
		{/if}
		{#if error}
			<p class="text-sm text-destructive" role="alert">{error}</p>
		{/if}

		{#if step === 1}
			<Card.Root>
				<Card.Header>
					<Card.Title>1. Sicherungsdatei wählen</Card.Title>
					<Card.Description>
						Wähle eine mit „Sicherung erstellen“ erzeugte Datei ({constants.fileExt}).
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="sm:max-w-md">
						<FileField id="restore-file" accept={constants.fileExt} bind:file disabled={busy} />
					</div>
					{#if file}
						<p class="text-xs text-muted-foreground">
							{file.name} – {fmtBytes(file.size)}
						</p>
					{/if}
					{#if busy && uploadTotal > 0}
						<div class="space-y-1.5" aria-live="polite">
							<ProgressBar value={percent(uploaded, uploadTotal)} label="Fortschritt des Uploads" />
							<p class="text-xs text-muted-foreground tabular-nums">
								{fmtBytes(uploaded)} von {fmtBytes(uploadTotal)} ({percent(uploaded, uploadTotal)} %)
							</p>
						</div>
					{/if}
				</Card.Content>
				<Card.Footer class="flex flex-wrap justify-end gap-2">
					{#if busy}
						<Button variant="outline" onclick={() => (cancelUpload = true)}>Abbrechen</Button>
					{/if}
					<Button onclick={upload} disabled={!fileOk || busy}>
						<Upload aria-hidden="true" />
						{busy ? 'Upload läuft …' : 'Hochladen'}
					</Button>
				</Card.Footer>
			</Card.Root>
		{:else if step === 2}
			<Card.Root>
				<Card.Header>
					<Card.Title>2. Passwörter</Card.Title>
					<Card.Description>
						Das Sicherungs-Passwort entschlüsselt die Datei, mit deinem Konto-Passwort{twoFactorEnabled
							? ' und dem Code'
							: ''} bestätigst du den Vorgang.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<form
						id="restore-analyze"
						class="grid grid-cols-1 gap-4 sm:max-w-md"
						onsubmit={(e) => {
							e.preventDefault();
							void analyze();
						}}
					>
						<FormField
							label="Sicherungs-Passwort *"
							id="restore-backup-password"
							error={fieldErrors.backupPassword}
						>
							<Input
								id="restore-backup-password"
								type="password"
								autocomplete="off"
								bind:value={backupPassword}
								disabled={busy}
								required
								aria-invalid={fieldErrors.backupPassword ? true : undefined}
								aria-describedby={fieldErrors.backupPassword
									? 'restore-backup-password-error'
									: undefined}
							/>
						</FormField>
						<AccountFields
							idPrefix="restore"
							bind:password
							bind:totp
							{twoFactorEnabled}
							disabled={busy}
							errors={fieldErrors}
						/>
					</form>
				</Card.Content>
				<Card.Footer class="flex flex-wrap justify-between gap-2">
					<Button variant="outline" onclick={() => restart(1)} disabled={busy}>Andere Datei</Button>
					<Button type="submit" form="restore-analyze" disabled={!canAnalyze}>
						{busy ? 'Prüfung läuft …' : 'Prüfen'}
					</Button>
				</Card.Footer>
			</Card.Root>
		{:else if preview && step === 3}
			{@const b = preview.backup}
			<Card.Root>
				<Card.Header>
					<Card.Title>3. Vorschau</Card.Title>
					<Card.Description>
						Gültig bis {fmtDateTime(preview.expiresAt)}. Wähle Modus und Bereiche.
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-6">
					<dl class="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
						<div>
							<dt class="text-xs text-muted-foreground">Erstellt am</dt>
							<dd>{fmtDateTime(b.createdAt)}</dd>
						</div>
						<div>
							<dt class="text-xs text-muted-foreground">Erstellt von</dt>
							<dd>{b.createdBy}</dd>
						</div>
						<div>
							<dt class="text-xs text-muted-foreground">Version</dt>
							<dd class="tabular-nums">{b.appVersion}</dd>
						</div>
						<div>
							<dt class="text-xs text-muted-foreground">Herkunft</dt>
							<dd class="break-all">{b.sourceOrigin ?? 'unbekannt'}</dd>
						</div>
						<div>
							<dt class="text-xs text-muted-foreground">Dateien</dt>
							<dd>{b.includesFiles ? 'enthalten' : 'nicht enthalten'}</dd>
						</div>
					</dl>

					{#if preview.secretChanged}
						<Alert.Root>
							<Info aria-hidden="true" />
							<Alert.Title>Anderer Server-Schlüssel</Alert.Title>
							<Alert.Description>
								Die Sicherung stammt von einem Server mit anderem Schlüssel. Verschlüsselte Werte
								werden neu verschlüsselt und Prüfwerte neu berechnet; was sich nicht neu berechnen
								lässt, wird im Ergebnis gemeldet.
							</Alert.Description>
						</Alert.Root>
					{/if}

					<fieldset class="space-y-2">
						<legend class="mb-2 text-sm font-semibold">Modus</legend>
						<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
							{#each MODES as m (m.value)}
								<label
									class="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-checked:border-primary/50 has-checked:bg-primary/5"
								>
									<input
										type="radio"
										name="restore-mode"
										value={m.value}
										bind:group={mode}
										class="mt-1 accent-primary"
										onchange={() => (confirmValue = '')}
									/>
									<span class="space-y-1">
										<span class="block text-sm font-medium">{m.title}</span>
										<span class="block text-xs text-muted-foreground">{m.text}</span>
									</span>
								</label>
							{/each}
						</div>
					</fieldset>

					<fieldset class="space-y-2">
						<legend class="mb-2 text-sm font-semibold">Bereiche</legend>
						{#each preview.scopes as s (s.key)}
							{@const imp = implied.get(s.key)}
							{@const isChecked = s.available && (chosen.includes(s.key) || !!imp)}
							{@const backupRows = s.tables.reduce((n, t) => n + t.backupRows, 0)}
							{@const currentRows = s.tables.reduce((n, t) => n + t.currentRows, 0)}
							<div
								class="rounded-md border {isChecked
									? 'border-primary/40 bg-primary/5'
									: ''} {s.available ? '' : 'opacity-70'}"
							>
								<div class="flex items-start gap-3 p-3">
									<Checkbox
										id={cid(s.key)}
										class="mt-0.5"
										checked={isChecked}
										disabled={!s.available || !!imp}
										onCheckedChange={(v) => toggle(s.key, v === true)}
									/>
									<div class="min-w-0 flex-1 space-y-1">
										<Label for={cid(s.key)} class="flex flex-wrap items-center gap-2 font-medium">
											{s.label}
											<Badge variant="outline">{s.group === 'core' ? 'Core' : 'Modul'}</Badge>
											{#if !s.available}
												<Badge variant="secondary"><Lock aria-hidden="true" />nicht verfügbar</Badge
												>
											{:else if imp}
												<Badge variant="secondary"><Lock aria-hidden="true" />automatisch</Badge>
											{/if}
										</Label>
										<p class="text-xs text-muted-foreground tabular-nums">
											Sicherung: {fmt(backupRows)} Datensätze · aktuell: {fmt(currentRows)}{s.files
												.count
												? ` · ${fmt(s.files.count)} Dateien (${fmtBytes(s.files.bytes)})`
												: ''}
										</p>
										{#if !s.available && s.reason}
											<p class="text-xs text-destructive">{s.reason}</p>
										{/if}
										{#if imp}
											<p class="text-xs text-warning">
												Geht mit, weil „{labelOf(imp.by)}“ gewählt ist – {imp.reason}
											</p>
										{/if}
									</div>
								</div>
								{#if s.tables.length}
									<details class="group border-t">
										<summary
											class="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
										>
											<ChevronRight
												class="size-3.5 transition-transform group-open:rotate-90"
												aria-hidden="true"
											/>
											{s.tables.length}
											{s.tables.length === 1 ? 'Tabelle' : 'Tabellen'} anzeigen
										</summary>
										<div class="overflow-x-auto">
											<Table.Root>
												<Table.Header>
													<Table.Row>
														<Table.Head>Tabelle</Table.Head>
														<Table.Head class="text-right">Sicherung</Table.Head>
														<Table.Head class="text-right">Aktuell</Table.Head>
													</Table.Row>
												</Table.Header>
												<Table.Body>
													{#each s.tables as t (t.table)}
														<Table.Row>
															<Table.Cell><code class="text-xs">{t.table}</code></Table.Cell>
															<Table.Cell class="text-right tabular-nums">
																{fmt(t.backupRows)}
															</Table.Cell>
															<Table.Cell class="text-right tabular-nums">
																{fmt(t.currentRows)}
															</Table.Cell>
														</Table.Row>
													{/each}
												</Table.Body>
											</Table.Root>
										</div>
									</details>
								{/if}
							</div>
						{/each}
					</fieldset>

					<fieldset class="space-y-2">
						<legend class="mb-2 text-sm font-semibold">Optionen</legend>
						<div class="flex items-start gap-3">
							<Checkbox
								id="restore-smtp"
								class="mt-0.5"
								bind:checked={takeSmtp}
								aria-describedby="restore-smtp-desc"
							/>
							<div class="space-y-1">
								<Label for="restore-smtp">Mail-Zugang übernehmen</Label>
								<p id="restore-smtp-desc" class="text-xs text-muted-foreground">
									SMTP-Einstellungen aus der Sicherung statt der aktuellen verwenden.
								</p>
							</div>
						</div>
						{#if mode === 'restore'}
							<div class="flex items-start gap-3">
								<Checkbox
									id="restore-modules"
									class="mt-0.5"
									bind:checked={applyModuleState}
									aria-describedby="restore-modules-desc"
								/>
								<div class="space-y-1">
									<Label for="restore-modules">Modulstatus übernehmen</Label>
									<p id="restore-modules-desc" class="text-xs text-muted-foreground">
										Module so aktivieren bzw. deaktivieren wie zum Zeitpunkt der Sicherung.
									</p>
								</div>
							</div>
						{/if}
					</fieldset>

					{#if usersChosen && mode === 'restore'}
						<Alert.Root>
							<Info aria-hidden="true" />
							<Alert.Title>Dein Konto</Alert.Title>
							<Alert.Description class="space-y-1">
								<p>
									{preview.account.case === 'same'
										? 'Dein Konto ist mit gleichem Passwort in der Sicherung enthalten.'
										: 'Dein aktuelles Konto bleibt zusätzlich erhalten, damit du dich nicht aussperrst.'}
								</p>
								{#if preview.account.willLogout}
									<p>
										Du wirst danach abgemeldet und meldest dich mit den Zugangsdaten aus der
										Sicherung neu an.
									</p>
								{/if}
								{#if preview.account.twoFactorInBackup}
									<p>
										In der Sicherung ist für dein Konto die Zwei-Faktor-Anmeldung aktiv – halte die
										damalige Authenticator-App bereit.
									</p>
								{/if}
							</Alert.Description>
						</Alert.Root>
					{/if}

					{#if preview.missingUserRefs > 0}
						<Alert.Root variant="warning">
							<TriangleAlert aria-hidden="true" />
							<Alert.Description>
								{fmt(preview.missingUserRefs)}
								{preview.missingUserRefs === 1 ? 'Verweis' : 'Verweise'} auf Benutzer*innen, die es im
								Ziel nicht gibt. Diese Einträge erscheinen danach als „Unbekannt“.
							</Alert.Description>
						</Alert.Root>
					{/if}

					{#if preview.warnings.length}
						<Alert.Root variant="warning">
							<TriangleAlert aria-hidden="true" />
							<Alert.Title>Hinweise</Alert.Title>
							<Alert.Description>
								<ul class="list-disc space-y-1 pl-4">
									{#each preview.warnings as w, i (i)}<li>{w}</li>{/each}
								</ul>
							</Alert.Description>
						</Alert.Root>
					{/if}
				</Card.Content>
				<Card.Footer class="flex flex-wrap items-center justify-between gap-2">
					<Button variant="outline" onclick={() => restart(2)}>Zurück</Button>
					<div class="flex flex-wrap items-center gap-3">
						<span class="text-xs text-muted-foreground" aria-live="polite">
							{allChosen.length}
							{allChosen.length === 1 ? 'Bereich' : 'Bereiche'} gewählt
						</span>
						<Button onclick={() => (step = 4)} disabled={!allChosen.length}>
							Weiter zur Bestätigung
						</Button>
					</div>
				</Card.Footer>
			</Card.Root>
		{:else if preview && step === 4}
			<Card.Root class={mode === 'restore' ? 'border-destructive/50' : ''}>
				<Card.Header>
					<Card.Title>4. {mode === 'restore' ? 'Wiederherstellen' : 'Zusammenführen'}</Card.Title>
					<Card.Description>{summary}</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					<ul class="flex flex-wrap gap-1.5">
						{#each allChosen as key (key)}
							<li><Badge variant="secondary">{labelOf(key)}</Badge></li>
						{/each}
					</ul>
					<div class="sm:max-w-sm">
						<TypedConfirmField
							id="restore-confirm"
							{word}
							bind:value={confirmValue}
							bind:confirmed
							disabled={busy}
						/>
					</div>
				</Card.Content>
				<Card.Footer class="flex flex-wrap justify-between gap-2">
					<Button variant="outline" onclick={() => (step = 3)} disabled={busy}>Zurück</Button>
					<Button
						variant="destructive-solid"
						disabled={!confirmed || busy}
						onclick={() => (dialogOpen = true)}
					>
						{busy
							? 'Wird gestartet …'
							: mode === 'restore'
								? 'Jetzt wiederherstellen'
								: 'Jetzt zusammenführen'}
					</Button>
				</Card.Footer>
			</Card.Root>
		{/if}
	</div>
{/if}

<ConfirmDialog
	bind:open={dialogOpen}
	title={mode === 'restore' ? 'Wirklich wiederherstellen?' : 'Wirklich zusammenführen?'}
	description={summary}
	confirmLabel={mode === 'restore' ? 'Wiederherstellen' : 'Zusammenführen'}
	destructive
	onconfirm={execute}
/>
