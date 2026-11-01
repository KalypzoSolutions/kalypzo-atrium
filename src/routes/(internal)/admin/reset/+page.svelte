<script lang="ts">
	import { t } from '$lib/i18n';
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Download from '@lucide/svelte/icons/download';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Lock from '@lucide/svelte/icons/lock';
	import { toast } from 'svelte-sonner';
	import { formatNumber, formatTime } from '$lib/i18n/intl';
	import { ConfirmDialog, PageHeader, PageTitle } from '$lib/components/layout';
	import TypedConfirmField from '$lib/components/layout/TypedConfirmField.svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import type { PageData } from './$types';

	type Area = PageData['areas'][number];
	interface Preview {
		areas: string[];
		implied: { area: string; by: string; reason: string }[];
		tables: { area: string; table: string; rows: number }[];
		files: { module: string; count: number; bytes: number }[];
		token: string;
		expiresAt: string;
	}
	interface ResetResult {
		areas: string[];
		deletedRows: number;
		deletedFiles: number;
		warnings: string[];
	}

	let { data }: { data: PageData } = $props();

	const STEPS = [
		t('admin-reset.steps.areas'),
		t('admin-reset.steps.preview'),
		t('admin-reset.steps.backup'),
		t('admin-reset.steps.confirm')
	];

	let step = $state(1);
	let selected = $state<string[]>([]);
	let preview = $state<Preview | null>(null);
	let busy = $state(false);
	let error = $state('');
	let expired = $state(false);
	let expiredMessage = $state('');

	let password = $state('');
	let totp = $state('');
	let exportedFile = $state<string | null>(null);

	let confirmValue = $state('');
	let confirmed = $state(false);
	let dialogOpen = $state(false);
	let result = $state<ResetResult | null>(null);

	const areasByKey = $derived(new Map<string, Area>(data.areas.map((a) => [a.key, a])));

	const groups = $derived.by(() => {
		const out: { name: string; areas: Area[] }[] = [];
		for (const a of data.areas) {
			let g = out.find((x) => x.name === a.group);
			if (!g) {
				g = { name: a.group, areas: [] };
				out.push(g);
			}
			g.areas.push(a);
		}
		return out;
	});

	function labelOf(key: string): string {
		const a = areasByKey.get(key);
		return a ? `${a.group}: ${a.label}` : key;
	}

	/** Automatisch mitgewählte Bereiche (transitiv), mit Auslöser und Begründung. */
	const implied = $derived.by(() => {
		const explicit = new Set(selected);
		const out = new Map<string, { by: string; reason: string }>();
		const queue = [...selected];
		const add = (key: string, by: string, reason: string) => {
			if (explicit.has(key) || out.has(key) || !areasByKey.has(key)) return;
			out.set(key, { by, reason });
			queue.push(key);
		};
		while (queue.length) {
			const key = queue.shift()!;
			const area = areasByKey.get(key);
			if (!area) continue;
			for (const imp of area.implies) add(imp.area, key, imp.reason);
			// „Alles“ eines Moduls umfasst dessen übrige Bereiche
			if (key.endsWith(':all')) {
				const prefix = key.slice(0, -3);
				for (const other of data.areas) {
					if (other.key !== key && other.key.startsWith(prefix)) {
						add(other.key, key, t('admin-reset.containedFully'));
					}
				}
			}
		}
		return out;
	});

	const totalCount = $derived(selected.length + implied.size);

	function toggle(key: string, on: boolean) {
		selected = on ? [...new Set([...selected, key])] : selected.filter((k) => k !== key);
	}

	const fmt = (n: number) => formatNumber(n);
	const fmtMb = (bytes: number) => formatNumber(bytes / (1024 * 1024), 1) + ' MB';
	const fmtTime = (iso: string) => formatTime(iso);

	const rowSum = $derived(preview ? preview.tables.reduce((s, t) => s + t.rows, 0) : 0);
	const fileSum = $derived(preview ? preview.files.reduce((s, f) => s + f.count, 0) : 0);
	const byteSum = $derived(preview ? preview.files.reduce((s, f) => s + f.bytes, 0) : 0);

	type ActionOutcome =
		{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; message: string };

	async function callAction(name: string, body: FormData): Promise<ActionOutcome> {
		const res = await fetch(`?/${name}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		const r = deserialize(await res.text());
		if (r.type === 'success') return { ok: true, data: (r.data ?? {}) as Record<string, unknown> };
		if (r.type === 'failure') {
			const d = (r.data ?? {}) as { message?: string };
			return { ok: false, status: r.status, message: d.message ?? t('admin-reset.actionFailed') };
		}
		if (r.type === 'error') {
			return { ok: false, status: r.status ?? 500, message: t('admin-reset.unexpectedError') };
		}
		return { ok: false, status: 500, message: t('admin-reset.unexpectedResponse') };
	}

	function handleFailure(status: number, message: string) {
		if (status === 409) {
			expired = true;
			expiredMessage = message;
			error = '';
		} else {
			error = message;
			toast.error(message);
		}
	}

	async function loadPreview() {
		if (!selected.length || busy) return;
		busy = true;
		error = '';
		expired = false;
		try {
			const fd = new FormData();
			for (const key of selected) fd.append('areas', key);
			const r = await callAction('preview', fd);
			if (r.ok) {
				preview = r.data.preview as Preview;
				exportedFile = null;
				confirmValue = '';
				step = 2;
			} else handleFailure(r.status, r.message);
		} catch {
			error = t('admin-reset.previewFailed');
		} finally {
			busy = false;
		}
	}

	const totpValid = $derived(!data.twoFactorEnabled || /^\d{6}$/.test(totp));
	// Verschlüsselte Sicherung: Passwort wie bei der Datensicherung (mind. 12 Zeichen, zweimal)
	const BACKUP_PW_MIN = 12;
	let backupPassword = $state('');
	let backupPassword2 = $state('');
	const backupPwError = $derived(
		backupPassword.length > 0 && backupPassword.length < BACKUP_PW_MIN
			? t('admin-reset.minChars', { count: BACKUP_PW_MIN })
			: backupPassword2.length > 0 && backupPassword2 !== backupPassword
				? t('admin-reset.mismatch')
				: ''
	);
	const backupPwValid = $derived(
		backupPassword.length >= BACKUP_PW_MIN && backupPassword === backupPassword2
	);
	const canExport = $derived(
		!!preview && password.length > 0 && totpValid && backupPwValid && !busy
	);

	async function downloadExport() {
		if (!preview || !canExport) return;
		busy = true;
		error = '';
		try {
			const res = await fetch('/admin/reset/export', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					token: preview.token,
					password,
					backupPassword,
					...(data.twoFactorEnabled ? { totp } : {})
				})
			});
			if (!res.ok) {
				const b = (await res.json().catch(() => null)) as { message?: string } | null;
				handleFailure(res.status, b?.message ?? t('admin-reset.exportFailed'));
				return;
			}
			const name =
				/filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
				'atrium-reset.atriumbackup';
			const blob = await res.blob();
			const href = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = href;
			a.download = name;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(href), 10_000);
			exportedFile = name;
			password = '';
			totp = '';
			backupPassword = '';
			backupPassword2 = '';
			toast.success(t('admin-reset.downloaded'));
		} catch {
			error = t('admin-reset.exportFailed');
		} finally {
			busy = false;
		}
	}

	async function execute() {
		if (!preview || !confirmed || busy) return;
		busy = true;
		error = '';
		try {
			const fd = new FormData();
			fd.set('token', preview.token);
			fd.set('confirmWord', confirmValue);
			const r = await callAction('execute', fd);
			if (r.ok) {
				result = r.data.result as ResetResult;
				toast.success(t('admin-reset.done'));
				await invalidateAll();
			} else handleFailure(r.status, r.message);
		} catch {
			error = t('admin-reset.failed');
		} finally {
			busy = false;
		}
	}

	/** Nach Ablauf des Tokens: zurück zu Schritt 1, Auswahl bleibt erhalten. */
	function restart(clearSelection = false) {
		step = 1;
		preview = null;
		expired = false;
		error = '';
		password = '';
		totp = '';
		backupPassword = '';
		backupPassword2 = '';
		exportedFile = null;
		confirmValue = '';
		result = null;
		if (clearSelection) selected = [];
	}

	const summary = $derived(
		preview
			? t('admin-reset.summary', {
					rows: fmt(rowSum),
					files: fmt(fileSum),
					size: fmtMb(byteSum),
					count: preview.areas.length
				})
			: ''
	);
</script>

<PageTitle title={t('admin-reset.title')} />

<div class="mx-auto max-w-4xl space-y-6">
	<PageHeader title={t('admin-reset.title')} description={t('admin-reset.description')} />

	{#if result}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<CircleCheck class="size-5 text-success" aria-hidden="true" />
					{t('admin-reset.done')}
				</Card.Title>
				<Card.Description>
					{t('admin-reset.resultAreas', { count: result.areas.length })}
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<dl class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<div class="rounded-lg border p-3">
						<dt class="text-xs text-muted-foreground">{t('admin-reset.areas')}</dt>
						<dd class="text-2xl font-semibold tabular-nums">{fmt(result.areas.length)}</dd>
					</div>
					<div class="rounded-lg border p-3">
						<dt class="text-xs text-muted-foreground">{t('admin-reset.deletedRows')}</dt>
						<dd class="text-2xl font-semibold tabular-nums">{fmt(result.deletedRows)}</dd>
					</div>
					<div class="rounded-lg border p-3">
						<dt class="text-xs text-muted-foreground">{t('admin-reset.deletedFiles')}</dt>
						<dd class="text-2xl font-semibold tabular-nums">{fmt(result.deletedFiles)}</dd>
					</div>
				</dl>
				<ul class="flex flex-wrap gap-1.5">
					{#each result.areas as key (key)}
						<li><Badge variant="secondary">{labelOf(key)}</Badge></li>
					{/each}
				</ul>
				{#if result.warnings.length}
					<Alert.Root variant="warning">
						<TriangleAlert aria-hidden="true" />
						<Alert.Title>{t('admin-reset.warnings')}</Alert.Title>
						<Alert.Description>
							<ul class="list-disc space-y-1 pl-4">
								{#each result.warnings as w, i (i)}<li>{w}</li>{/each}
							</ul>
						</Alert.Description>
					</Alert.Root>
				{/if}
			</Card.Content>
			<Card.Footer class="flex flex-wrap justify-end gap-2">
				<Button variant="outline" href="/dashboard">{t('admin-reset.toDashboard')}</Button>
				<Button onclick={() => restart(true)}>{t('admin-reset.newRun')}</Button>
			</Card.Footer>
		</Card.Root>
	{:else}
		<Alert.Root variant="destructive" class="border-destructive/50 bg-destructive/5">
			<TriangleAlert aria-hidden="true" />
			<Alert.Title>{t('admin-reset.dangerTitle')}</Alert.Title>
			<Alert.Description>
				{t('admin-reset.dangerText')}
			</Alert.Description>
		</Alert.Root>

		<ol class="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label={t('admin-reset.stepsLabel')}>
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

		{#if expired}
			<Alert.Root variant="destructive">
				<TriangleAlert aria-hidden="true" />
				<Alert.Title>{t('admin-reset.expiredTitle')}</Alert.Title>
				<Alert.Description class="space-y-2">
					<p>
						{expiredMessage || t('admin-reset.expiredDefault')}
						{t('admin-reset.expiredRestart')}
					</p>
					<Button size="sm" variant="outline" onclick={() => restart()}
						>{t('admin-reset.startOver')}</Button
					>
				</Alert.Description>
			</Alert.Root>
		{/if}

		{#if error}
			<p class="text-sm text-destructive" role="alert">{error}</p>
		{/if}

		{#if step === 1}
			<Card.Root>
				<Card.Header>
					<Card.Title>{t('admin-reset.step1Title')}</Card.Title>
					<Card.Description>
						{t('admin-reset.step1Text')}
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-6">
					{#if !data.areas.length}
						<p class="text-sm text-muted-foreground">{t('admin-reset.noAreas')}</p>
					{/if}
					{#each groups as g (g.name)}
						<fieldset class="space-y-2">
							<legend class="mb-2 text-sm font-semibold">{g.name}</legend>
							{#each g.areas as a (a.key)}
								{@const imp = implied.get(a.key)}
								{@const isChecked = selected.includes(a.key) || !!imp}
								{@const cid = `area-${a.key.replace(/[^a-z0-9-]/gi, '-')}`}
								<div
									class="flex items-start gap-3 rounded-md border p-3 {isChecked
										? 'border-destructive/40 bg-destructive/5'
										: ''}"
								>
									<Checkbox
										id={cid}
										class="mt-0.5"
										checked={isChecked}
										disabled={!!imp || busy}
										onCheckedChange={(v) => toggle(a.key, v === true)}
										aria-describedby="{cid}-desc"
									/>
									<div class="min-w-0 flex-1 space-y-1">
										<Label for={cid} class="flex flex-wrap items-center gap-2 font-medium">
											{a.label}
											{#if a.rebuild}
												<Badge variant="outline">{t('admin-reset.rebuild')}</Badge>
											{/if}
											{#if imp}
												<Badge variant="secondary"
													><Lock aria-hidden="true" />{t('admin-reset.automatic')}</Badge
												>
											{/if}
										</Label>
										<p id="{cid}-desc" class="text-xs text-muted-foreground">{a.description}</p>
										{#if imp}
											<p class="text-xs text-warning">
												{t('admin-reset.impliedBecause', {
													by: labelOf(imp.by),
													reason: imp.reason
												})}
											</p>
										{/if}
									</div>
								</div>
							{/each}
						</fieldset>
					{/each}
				</Card.Content>
				<Card.Footer class="flex flex-wrap items-center justify-between gap-2">
					<p class="text-xs text-muted-foreground" aria-live="polite">
						{t('admin-reset.selectedCount', { count: totalCount })}
					</p>
					<Button onclick={loadPreview} disabled={!selected.length || busy}>
						{busy ? t('admin-reset.loading') : t('admin-reset.toPreview')}
					</Button>
				</Card.Footer>
			</Card.Root>
		{:else if preview}
			<p class="text-xs text-muted-foreground">
				{t('admin-reset.validUntil', { time: fmtTime(preview.expiresAt) })}
			</p>

			{#if step === 2}
				<Card.Root>
					<Card.Header>
						<Card.Title>{t('admin-reset.step2Title')}</Card.Title>
						<Card.Description>
							{t('admin-reset.step2Text')}
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-6">
						<ul class="flex flex-wrap gap-1.5">
							{#each preview.areas as key (key)}
								{@const imp = preview.implied.find((i) => i.area === key)}
								<li>
									<Badge variant={imp ? 'secondary' : 'destructive'} title={imp?.reason}>
										{labelOf(key)}{imp ? t('admin-reset.automaticSuffix') : ''}
									</Badge>
								</li>
							{/each}
						</ul>

						<div class="overflow-x-auto">
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head>{t('admin-reset.area')}</Table.Head>
										<Table.Head>{t('admin-reset.table')}</Table.Head>
										<Table.Head class="text-right">{t('admin-reset.count')}</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each preview.tables as row (row.area + '/' + row.table)}
										<Table.Row>
											<Table.Cell class="whitespace-normal">{labelOf(row.area)}</Table.Cell>
											<Table.Cell><code class="text-xs">{row.table}</code></Table.Cell>
											<Table.Cell class="text-right tabular-nums">{fmt(row.rows)}</Table.Cell>
										</Table.Row>
									{:else}
										<Table.Row>
											<Table.Cell colspan={3} class="text-muted-foreground"
												>{t('admin-reset.noTables')}</Table.Cell
											>
										</Table.Row>
									{/each}
								</Table.Body>
								<Table.Footer>
									<Table.Row>
										<Table.Cell colspan={2} class="font-semibold"
											>{t('admin-reset.rowSum')}</Table.Cell
										>
										<Table.Cell class="text-right font-semibold tabular-nums"
											>{fmt(rowSum)}</Table.Cell
										>
									</Table.Row>
								</Table.Footer>
							</Table.Root>
						</div>

						<div class="overflow-x-auto">
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head>{t('admin-reset.filesPerModule')}</Table.Head>
										<Table.Head class="text-right">{t('admin-reset.count')}</Table.Head>
										<Table.Head class="text-right">{t('admin-reset.size')}</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each preview.files as f (f.module)}
										<Table.Row>
											<Table.Cell>{f.module}</Table.Cell>
											<Table.Cell class="text-right tabular-nums">{fmt(f.count)}</Table.Cell>
											<Table.Cell class="text-right tabular-nums">{fmtMb(f.bytes)}</Table.Cell>
										</Table.Row>
									{:else}
										<Table.Row>
											<Table.Cell colspan={3} class="text-muted-foreground">
												{t('admin-reset.noFiles')}
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
								{#if preview.files.length}
									<Table.Footer>
										<Table.Row>
											<Table.Cell class="font-semibold">{t('admin-reset.sum')}</Table.Cell>
											<Table.Cell class="text-right font-semibold tabular-nums"
												>{fmt(fileSum)}</Table.Cell
											>
											<Table.Cell class="text-right font-semibold tabular-nums"
												>{fmtMb(byteSum)}</Table.Cell
											>
										</Table.Row>
									</Table.Footer>
								{/if}
							</Table.Root>
						</div>
					</Card.Content>
					<Card.Footer class="flex flex-wrap justify-between gap-2">
						<Button variant="outline" onclick={() => restart()} disabled={busy}
							>{t('admin-reset.back')}</Button
						>
						<Button onclick={() => (step = 3)}>{t('admin-reset.toBackup')}</Button>
					</Card.Footer>
				</Card.Root>
			{:else if step === 3}
				<Card.Root>
					<Card.Header>
						<Card.Title>{t('admin-reset.step3Title')}</Card.Title>
						<Card.Description>
							{t('admin-reset.step3Text', { twoFactor: data.twoFactorEnabled ? 'yes' : 'no' })}
						</Card.Description>
					</Card.Header>
					<Card.Content>
						<form
							class="grid gap-4 sm:max-w-sm"
							onsubmit={(e) => {
								e.preventDefault();
								void downloadExport();
							}}
						>
							<div class="grid gap-1.5">
								<Label for="reset-password">{t('admin-reset.password')}</Label>
								<Input
									id="reset-password"
									type="password"
									autocomplete="current-password"
									bind:value={password}
									disabled={busy}
									required
								/>
							</div>
							{#if data.twoFactorEnabled}
								<div class="grid gap-1.5">
									<Label for="reset-totp">{t('admin-reset.totp')}</Label>
									<Input
										id="reset-totp"
										inputmode="numeric"
										autocomplete="one-time-code"
										maxlength={6}
										pattern="[0-9]{6}"
										bind:value={totp}
										disabled={busy}
										class="font-mono tracking-widest"
										required
									/>
								</div>
							{/if}
							<div class="grid gap-1.5">
								<Label for="reset-backup-pw">{t('admin-reset.backupPassword')}</Label>
								<Input
									id="reset-backup-pw"
									type="password"
									autocomplete="new-password"
									minlength={BACKUP_PW_MIN}
									maxlength={200}
									bind:value={backupPassword}
									disabled={busy}
									aria-describedby="reset-backup-pw-hint"
									required
								/>
								<p id="reset-backup-pw-hint" class="text-xs text-muted-foreground">
									{t('admin-reset.backupPasswordHint', { count: BACKUP_PW_MIN })}
								</p>
							</div>
							<div class="grid gap-1.5">
								<Label for="reset-backup-pw2">{t('admin-reset.backupPasswordRepeat')}</Label>
								<Input
									id="reset-backup-pw2"
									type="password"
									autocomplete="new-password"
									maxlength={200}
									bind:value={backupPassword2}
									disabled={busy}
									aria-invalid={backupPwError ? true : undefined}
									aria-describedby={backupPwError ? 'reset-backup-pw-error' : undefined}
									required
								/>
								{#if backupPwError}
									<p id="reset-backup-pw-error" class="text-xs text-destructive" role="alert">
										{backupPwError}
									</p>
								{/if}
							</div>
							<div>
								<Button type="submit" disabled={!canExport}>
									<Download aria-hidden="true" />
									{busy ? t('admin-reset.creating') : t('admin-reset.downloadExport')}
								</Button>
							</div>
						</form>
						{#if exportedFile}
							<p class="mt-4 flex items-center gap-2 text-sm text-success" role="status">
								<CircleCheck class="size-4" aria-hidden="true" />
								{t('admin-reset.exportedFile', { file: exportedFile })}
							</p>
						{/if}
					</Card.Content>
					<Card.Footer class="flex flex-wrap justify-between gap-2">
						<Button variant="outline" onclick={() => (step = 2)} disabled={busy}
							>{t('admin-reset.back')}</Button
						>
						<Button onclick={() => (step = 4)} disabled={!exportedFile || busy}>
							{t('admin-reset.toConfirm')}
						</Button>
					</Card.Footer>
				</Card.Root>
			{:else if step === 4}
				<Card.Root class="border-destructive/50">
					<Card.Header>
						<Card.Title>{t('admin-reset.step4Title')}</Card.Title>
						<Card.Description>{summary}</Card.Description>
					</Card.Header>
					<Card.Content class="sm:max-w-sm">
						<TypedConfirmField
							id="reset-confirm"
							word={data.confirmWord}
							alsoAccept={[data.legacyConfirmWord]}
							bind:value={confirmValue}
							bind:confirmed
							disabled={busy}
						/>
					</Card.Content>
					<Card.Footer class="flex flex-wrap justify-between gap-2">
						<Button variant="outline" onclick={() => (step = 3)} disabled={busy}
							>{t('admin-reset.back')}</Button
						>
						<Button
							variant="destructive-solid"
							disabled={!confirmed || busy || expired}
							onclick={() => (dialogOpen = true)}
						>
							{busy ? t('admin-reset.resetting') : t('admin-reset.resetNow')}
						</Button>
					</Card.Footer>
				</Card.Root>
			{/if}
		{/if}
	{/if}
</div>

<ConfirmDialog
	bind:open={dialogOpen}
	title={t('admin-reset.confirmTitle')}
	description={summary}
	confirmLabel={t('admin-reset.resetNow')}
	destructive
	onconfirm={execute}
/>
