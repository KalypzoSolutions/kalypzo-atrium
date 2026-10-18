<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Download from '@lucide/svelte/icons/download';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Lock from '@lucide/svelte/icons/lock';
	import { toast } from 'svelte-sonner';
	import { ConfirmDialog, PageHeader } from '$lib/components/layout';
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

	const STEPS = ['Bereiche wählen', 'Vorschau', 'Sicherung', 'Bestätigen'] as const;

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
						add(other.key, key, 'der Bereich ist darin vollständig enthalten.');
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

	const fmt = (n: number) => n.toLocaleString('de-DE');
	const fmtMb = (bytes: number) =>
		(bytes / (1024 * 1024)).toLocaleString('de-DE', {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		}) + ' MB';
	const fmtTime = (iso: string) =>
		new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

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
			return { ok: false, status: r.status, message: d.message ?? 'Aktion fehlgeschlagen' };
		}
		if (r.type === 'error') {
			return { ok: false, status: r.status ?? 500, message: 'Unerwarteter Fehler' };
		}
		return { ok: false, status: 500, message: 'Unerwartete Antwort' };
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
			error = 'Vorschau konnte nicht geladen werden';
		} finally {
			busy = false;
		}
	}

	const totpValid = $derived(!data.twoFactorEnabled || /^\d{6}$/.test(totp));
	const canExport = $derived(!!preview && password.length > 0 && totpValid && !busy);

	async function downloadExport() {
		if (!preview || !canExport) return;
		busy = true;
		error = '';
		try {
			const res = await fetch('/system/reset/export', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					token: preview.token,
					password,
					...(data.twoFactorEnabled ? { totp } : {})
				})
			});
			if (!res.ok) {
				const b = (await res.json().catch(() => null)) as { message?: string } | null;
				handleFailure(res.status, b?.message ?? 'Export fehlgeschlagen');
				return;
			}
			const name =
				/filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
				'ep-intern-sicherung.json';
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
			toast.success('Sicherung heruntergeladen');
		} catch {
			error = 'Export fehlgeschlagen';
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
				toast.success('Zurücksetzen abgeschlossen');
				await invalidateAll();
			} else handleFailure(r.status, r.message);
		} catch {
			error = 'Zurücksetzen fehlgeschlagen';
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
		exportedFile = null;
		confirmValue = '';
		result = null;
		if (clearSelection) selected = [];
	}

	const summary = $derived(
		preview
			? `Es werden ${fmt(rowSum)} Datensätze und ${fmt(fileSum)} Dateien (${fmtMb(byteSum)}) in ` +
					`${preview.areas.length} ${preview.areas.length === 1 ? 'Bereich' : 'Bereichen'} endgültig gelöscht. ` +
					'Das lässt sich nicht rückgängig machen.'
			: ''
	);
</script>

<svelte:head><title>Zurücksetzen</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-6">
	<PageHeader
		title="Zurücksetzen"
		description="Daten einzelner Bereiche oder des ganzen Systems endgültig löschen – mit Sicherung vorab."
	/>

	{#if result}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<CircleCheck class="size-5 text-green-600 dark:text-green-500" aria-hidden="true" />
					Zurücksetzen abgeschlossen
				</Card.Title>
				<Card.Description>
					{result.areas.length}
					{result.areas.length === 1 ? 'Bereich wurde' : 'Bereiche wurden'} zurückgesetzt.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<dl class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<div class="rounded-lg border p-3">
						<dt class="text-xs text-muted-foreground">Bereiche</dt>
						<dd class="text-2xl font-semibold tabular-nums">{fmt(result.areas.length)}</dd>
					</div>
					<div class="rounded-lg border p-3">
						<dt class="text-xs text-muted-foreground">Gelöschte Datensätze</dt>
						<dd class="text-2xl font-semibold tabular-nums">{fmt(result.deletedRows)}</dd>
					</div>
					<div class="rounded-lg border p-3">
						<dt class="text-xs text-muted-foreground">Gelöschte Dateien</dt>
						<dd class="text-2xl font-semibold tabular-nums">{fmt(result.deletedFiles)}</dd>
					</div>
				</dl>
				<ul class="flex flex-wrap gap-1.5">
					{#each result.areas as key (key)}
						<li><Badge variant="secondary">{labelOf(key)}</Badge></li>
					{/each}
				</ul>
				{#if result.warnings.length}
					<Alert.Root>
						<TriangleAlert class="text-amber-600" aria-hidden="true" />
						<Alert.Title>Hinweise</Alert.Title>
						<Alert.Description>
							<ul class="list-disc space-y-1 pl-4">
								{#each result.warnings as w, i (i)}<li>{w}</li>{/each}
							</ul>
						</Alert.Description>
					</Alert.Root>
				{/if}
			</Card.Content>
			<Card.Footer class="flex flex-wrap justify-end gap-2">
				<Button variant="outline" href="/dashboard">Zum Dashboard</Button>
				<Button onclick={() => restart(true)}>Neuen Vorgang starten</Button>
			</Card.Footer>
		</Card.Root>
	{:else}
		<Alert.Root variant="destructive" class="border-destructive/50 bg-destructive/5">
			<TriangleAlert aria-hidden="true" />
			<Alert.Title>Achtung: Diese Aktion löscht Daten endgültig</Alert.Title>
			<Alert.Description>
				Ausgewählte Bereiche werden unwiderruflich gelöscht, auch hochgeladene Dateien. Lade vorher
				die Sicherung herunter und bewahre sie sicher auf – sie enthält personenbezogene Daten.
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
								? 'border-primary text-primary'
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
				<Alert.Title>Vorgang abgelaufen</Alert.Title>
				<Alert.Description class="space-y-2">
					<p>
						{expiredMessage ||
							'Die Vorschau ist nicht mehr gültig (abgelaufen oder bereits verwendet).'}
						Bitte starte den Vorgang neu – deine Auswahl bleibt erhalten.
					</p>
					<Button size="sm" variant="outline" onclick={() => restart()}>Neu beginnen</Button>
				</Alert.Description>
			</Alert.Root>
		{/if}

		{#if error}
			<p class="text-sm text-destructive" role="alert">{error}</p>
		{/if}

		{#if step === 1}
			<Card.Root>
				<Card.Header>
					<Card.Title>1. Bereiche wählen</Card.Title>
					<Card.Description>
						Wähle aus, was gelöscht werden soll. Abhängige Bereiche werden automatisch mit
						ausgewählt.
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-6">
					{#if !data.areas.length}
						<p class="text-sm text-muted-foreground">Es sind keine Bereiche verfügbar.</p>
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
												<Badge variant="outline">Neuaufbau</Badge>
											{/if}
											{#if imp}
												<Badge variant="secondary"><Lock aria-hidden="true" />automatisch</Badge>
											{/if}
										</Label>
										<p id="{cid}-desc" class="text-xs text-muted-foreground">{a.description}</p>
										{#if imp}
											<p class="text-xs text-amber-700 dark:text-amber-500">
												Wird mit zurückgesetzt, weil „{labelOf(imp.by)}“ gewählt ist – {imp.reason}
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
						{totalCount === 0
							? 'Nichts ausgewählt'
							: `${totalCount} ${totalCount === 1 ? 'Bereich' : 'Bereiche'} ausgewählt`}
					</p>
					<Button onclick={loadPreview} disabled={!selected.length || busy}>
						{busy ? 'Lädt …' : 'Weiter zur Vorschau'}
					</Button>
				</Card.Footer>
			</Card.Root>
		{:else if preview}
			<p class="text-xs text-muted-foreground">
				Vorgang gültig bis {fmtTime(preview.expiresAt)} Uhr.
			</p>

			{#if step === 2}
				<Card.Root>
					<Card.Header>
						<Card.Title>2. Vorschau</Card.Title>
						<Card.Description>
							Diese Daten werden gelöscht. Prüfe die Zahlen, bevor du weitergehst.
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-6">
						<ul class="flex flex-wrap gap-1.5">
							{#each preview.areas as key (key)}
								{@const imp = preview.implied.find((i) => i.area === key)}
								<li>
									<Badge variant={imp ? 'secondary' : 'destructive'} title={imp?.reason}>
										{labelOf(key)}{imp ? ' (automatisch)' : ''}
									</Badge>
								</li>
							{/each}
						</ul>

						<div class="overflow-x-auto">
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head>Bereich</Table.Head>
										<Table.Head>Tabelle</Table.Head>
										<Table.Head class="text-right">Anzahl</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each preview.tables as t (t.area + '/' + t.table)}
										<Table.Row>
											<Table.Cell class="whitespace-normal">{labelOf(t.area)}</Table.Cell>
											<Table.Cell><code class="text-xs">{t.table}</code></Table.Cell>
											<Table.Cell class="text-right tabular-nums">{fmt(t.rows)}</Table.Cell>
										</Table.Row>
									{:else}
										<Table.Row>
											<Table.Cell colspan={3} class="text-muted-foreground"
												>Keine Tabellen.</Table.Cell
											>
										</Table.Row>
									{/each}
								</Table.Body>
								<Table.Footer>
									<Table.Row>
										<Table.Cell colspan={2} class="font-semibold">Summe Datensätze</Table.Cell>
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
										<Table.Head>Dateien je Modul</Table.Head>
										<Table.Head class="text-right">Anzahl</Table.Head>
										<Table.Head class="text-right">Größe</Table.Head>
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
												Es werden keine Dateien gelöscht.
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
								{#if preview.files.length}
									<Table.Footer>
										<Table.Row>
											<Table.Cell class="font-semibold">Summe</Table.Cell>
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
						<Button variant="outline" onclick={() => restart()} disabled={busy}>Zurück</Button>
						<Button onclick={() => (step = 3)}>Weiter zur Sicherung</Button>
					</Card.Footer>
				</Card.Root>
			{:else if step === 3}
				<Card.Root>
					<Card.Header>
						<Card.Title>3. Sicherung herunterladen</Card.Title>
						<Card.Description>
							Bestätige mit deinem Passwort{data.twoFactorEnabled
								? ' und dem Code deiner Authenticator-App'
								: ''}. Die Sicherung enthält alle Daten der gewählten Bereiche als JSON-Datei (ohne
							hochgeladene Dateien).
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
								<Label for="reset-password">Passwort *</Label>
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
									<Label for="reset-totp">6-stelliger Code *</Label>
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
							<div>
								<Button type="submit" disabled={!canExport}>
									<Download aria-hidden="true" />
									{busy ? 'Erstellt …' : 'Export herunterladen'}
								</Button>
							</div>
						</form>
						{#if exportedFile}
							<p
								class="mt-4 flex items-center gap-2 text-sm text-green-700 dark:text-green-500"
								role="status"
							>
								<CircleCheck class="size-4" aria-hidden="true" />
								Sicherung „{exportedFile}“ heruntergeladen. Prüfe, ob die Datei vollständig
								gespeichert ist.
							</p>
						{/if}
					</Card.Content>
					<Card.Footer class="flex flex-wrap justify-between gap-2">
						<Button variant="outline" onclick={() => (step = 2)} disabled={busy}>Zurück</Button>
						<Button onclick={() => (step = 4)} disabled={!exportedFile || busy}>
							Weiter zur Bestätigung
						</Button>
					</Card.Footer>
				</Card.Root>
			{:else if step === 4}
				<Card.Root class="border-destructive/50">
					<Card.Header>
						<Card.Title>4. Endgültig zurücksetzen</Card.Title>
						<Card.Description>{summary}</Card.Description>
					</Card.Header>
					<Card.Content class="sm:max-w-sm">
						<TypedConfirmField
							id="reset-confirm"
							word={data.confirmWord}
							bind:value={confirmValue}
							bind:confirmed
							disabled={busy}
						/>
					</Card.Content>
					<Card.Footer class="flex flex-wrap justify-between gap-2">
						<Button variant="outline" onclick={() => (step = 3)} disabled={busy}>Zurück</Button>
						<Button
							class="bg-destructive text-white hover:bg-destructive/90"
							disabled={!confirmed || busy || expired}
							onclick={() => (dialogOpen = true)}
						>
							{busy ? 'Setzt zurück …' : 'Endgültig zurücksetzen'}
						</Button>
					</Card.Footer>
				</Card.Root>
			{/if}
		{/if}
	{/if}
</div>

<ConfirmDialog
	bind:open={dialogOpen}
	title="Wirklich endgültig zurücksetzen?"
	description={summary}
	confirmLabel="Endgültig zurücksetzen"
	destructive
	onconfirm={execute}
/>
