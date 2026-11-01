<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toast } from 'svelte-sonner';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { FileField, FormField, PageTitle } from '$lib/components/layout';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import AccountFields from '../../backup/AccountFields.svelte';
	import type {
		InstallPreview,
		InstallResult,
		SourceInspection
	} from '$lib/server/core/modules/install/service';
	import type { SupervisorStatus } from '$lib/server/core/modules/install/supervisor-link';
	import { onDestroy, onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Vorbelegung aus „Aktualisieren“ bzw. der Datensicherung: ?url=…&select=<modul>
	let url = $state(page.url.searchParams.get('url') ?? '');
	const preselect = page.url.searchParams.get('select');
	let file = $state<File | null>(null);
	let busy = $state<'inspect' | 'preview' | 'install' | 'settings' | null>(null);
	let fields = $state<Record<string, string>>({});
	let inspection = $state<SourceInspection | null>(null);
	let selected = $state<string[]>([]);
	let preview = $state<InstallPreview | null>(null);
	let result = $state<InstallResult | null>(null);
	let password = $state('');
	let totp = $state('');
	let accepted = $state(false);
	/** Neubau über den Supervisor: Stand und Plan, auf den gewartet wird */
	let build = $state<SupervisorStatus | null>(null);
	let waitingFor = $state<string | null>(null);
	let offline = $state(false);
	let timer: ReturnType<typeof setInterval> | undefined;

	const ACTIVE = new Set(['queued', 'building', 'verifying', 'restarting']);
	const STATE_LABEL: Record<string, string> = {
		queued: 'Wartet',
		building: 'Baut',
		verifying: 'Prüft',
		restarting: 'Startet neu',
		done: 'Fertig',
		failed: 'Fehlgeschlagen',
		idle: 'Bereit'
	};

	async function poll() {
		try {
			const res = await fetch('/admin/modules/install/status', { cache: 'no-store' });
			if (!res.ok) throw new Error(String(res.status));
			build = (await res.json()) as SupervisorStatus;
			offline = false;
			const finished = !ACTIVE.has(build.state) && (!waitingFor || build.planId === waitingFor);
			if (finished && waitingFor) {
				stopPolling();
				if (build.state === 'done')
					toast.success('Module installiert – der Server läuft mit der neuen Version');
				else if (build.state === 'failed') toast.error('Installation fehlgeschlagen');
			}
		} catch {
			// Während des Neustarts ist der Server kurz nicht erreichbar
			offline = true;
		}
	}

	function startPolling(planId: string | null) {
		waitingFor = planId;
		stopPolling();
		void poll();
		timer = setInterval(() => void poll(), 2000);
	}

	function stopPolling() {
		if (timer) clearInterval(timer);
		timer = undefined;
	}

	onDestroy(stopPolling);
	// Läuft schon ein Neubau (z. B. aus einem anderen Tab), Stand gleich zeigen
	onMount(() => {
		const sup = data.supervisor;
		if (sup && ACTIVE.has(sup.state)) startPolling(sup.planId);
	});

	const ACTION_LABEL: Record<string, string> = {
		install: 'Neu',
		update: 'Aktualisierung',
		reinstall: 'Neu einspielen',
		unchanged: 'Unverändert',
		downgrade: 'Ältere Version'
	};

	/** Gemeinsame Formularlogik: Ladezustand, Feldfehler, Ergebnis übernehmen (ohne Neuladen) */
	function submit(
		step: NonNullable<typeof busy>,
		onsuccess: (data: Record<string, unknown>) => void
	): SubmitFunction {
		return () => {
			busy = step;
			fields = {};
			return async ({ result: r, update }) => {
				busy = null;
				if (r.type === 'success') onsuccess((r.data ?? {}) as Record<string, unknown>);
				else if (r.type === 'failure') {
					const d = (r.data ?? {}) as { message?: string; fields?: Record<string, string> };
					fields = d.fields ?? {};
					toast.error(d.message ?? 'Aktion fehlgeschlagen');
				} else if (r.type === 'error') toast.error('Unerwarteter Fehler');
				else await update();
			};
		};
	}

	const onInspect = submit('inspect', (d) => {
		inspection = d.inspection as SourceInspection;
		preview = null;
		result = null;
		// Ein-Modul-Quelle: gleich auswählen
		selected =
			preselect && inspection.modules.some((m) => m.id === preselect)
				? [preselect]
				: inspection.modules.length === 1
					? [inspection.modules[0]!.id]
					: [];
	});
	const onPreview = submit('preview', (d) => {
		preview = d.preview as InstallPreview;
		accepted = false;
		password = '';
		totp = '';
	});
	const onInstall = submit('install', (d) => {
		result = d.result as InstallResult;
		preview = null;
		inspection = null;
		if (result.planId) startPolling(result.planId);
		else toast.success('Module installiert');
	});
	const onSettings = submit('settings', () => toast.success('Gespeichert'));

	function toggle(id: string, on: boolean) {
		selected = on ? [...new Set([...selected, id])] : selected.filter((s) => s !== id);
	}

	const canInstall = $derived(
		!!preview && !preview.blockers.length && preview.status.available && accepted
	);
</script>

<PageTitle title="Module installieren" />

<div class="space-y-6">
	{#if data.status.reason}
		<Alert.Root variant="info">
			<Alert.Title>Nur Vorschau</Alert.Title>
			<Alert.Description>{data.status.reason}</Alert.Description>
		</Alert.Root>
	{/if}

	<!-- 1. Quelle -->
	<Card.Root>
		<Card.Header>
			<Card.Title>1. Quelle wählen</Card.Title>
			<Card.Description>
				GitHub-Repository (ganz, ein Ordner oder ein Branch/Tag) oder eine ZIP-Datei. Ein Repository
				kann mehrere Module enthalten (Katalog <code>atrium-modules.json</code>).
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/inspect"
				enctype="multipart/form-data"
				use:enhance={onInspect}
				class="space-y-4"
			>
				<FormField
					label="GitHub-Link"
					id="install-url"
					error={fields.url}
					hint="z. B. https://github.com/org/ep-intern-modules oder github:org/repo/modules/kasse#v2.0.0"
				>
					<Input
						id="install-url"
						name="url"
						bind:value={url}
						placeholder="https://github.com/…"
						autocomplete="off"
						disabled={!!file}
					/>
				</FormField>
				<FormField
					label="oder ZIP-Datei (höchstens 50 MB)"
					id="install-file"
					error={fields.archive}
				>
					<FileField
						id="install-file"
						name="file"
						accept=".zip,application/zip"
						maxBytes={50 * 1024 * 1024}
						bind:file
					/>
				</FormField>
				<Button type="submit" disabled={busy !== null || (!url.trim() && !file)}>
					{busy === 'inspect' ? 'Lädt …' : 'Quelle laden'}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<!-- 2. Auswahl -->
	{#if inspection}
		<Card.Root>
			<Card.Header>
				<Card.Title>2. Module auswählen</Card.Title>
				<Card.Description>
					{inspection.catalogName ?? inspection.label}
					{#if inspection.commit}
						· Commit <code>{inspection.commit.slice(0, 10)}</code>{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form method="POST" action="?/preview" use:enhance={onPreview} class="space-y-4">
					<input type="hidden" name="sourceToken" value={inspection.token} />
					<ul class="divide-y rounded-md border" aria-label="Module der Quelle">
						{#each inspection.modules as m (m.id)}
							<li class="flex items-start gap-3 p-3">
								<Checkbox
									id="sel-{m.id}"
									name="selected"
									value={m.id}
									checked={selected.includes(m.id)}
									onCheckedChange={(v) => toggle(m.id, v === true)}
								/>
								<div class="min-w-0 flex-1 space-y-1">
									<Label for="sel-{m.id}" class="flex flex-wrap items-center gap-2">
										{m.name} <code class="text-xs text-muted-foreground">{m.id}</code>
										<Badge variant="outline">{m.version}</Badge>
										{#if m.installedVersion}
											<Badge variant="secondary">installiert: {m.installedVersion}</Badge>
										{/if}
									</Label>
									{#if m.description}<p class="text-sm text-muted-foreground">
											{m.description}
										</p>{/if}
									{#if m.dependencies.length}
										<p class="text-xs text-muted-foreground">
											Braucht: {m.dependencies.join(', ')}
										</p>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
					{#if inspection.problems.length}
						<Alert.Root variant="warning">
							<Alert.Title>Nicht lesbare Ordner</Alert.Title>
							<Alert.Description>
								<ul class="list-disc pl-5">
									{#each inspection.problems as p (p.dir)}<li>
											<code>{p.dir}</code>: {p.reason}
										</li>{/each}
								</ul>
							</Alert.Description>
						</Alert.Root>
					{/if}
					{#if fields.selected}<p class="text-xs text-destructive" role="alert">
							{fields.selected}
						</p>{/if}
					<Button type="submit" disabled={busy !== null || !selected.length}>
						{busy === 'preview' ? 'Prüft …' : 'Vorschau anzeigen'}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}

	<!-- 3. Vorschau -->
	{#if preview}
		<Card.Root>
			<Card.Header>
				<Card.Title>3. Vorschau</Card.Title>
				<Card.Description>
					Abhängigkeiten sind automatisch ergänzt. Neue Module sind nach der Installation
					deaktiviert.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#each preview.entries as e (e.id)}
					<section class="space-y-2 rounded-md border p-3" aria-label="Modul {e.name}">
						<h3 class="flex flex-wrap items-center gap-2 font-medium">
							{e.name} <code class="text-xs text-muted-foreground">{e.id}</code>
							<Badge
								variant={e.action === 'install'
									? 'info'
									: e.action === 'downgrade'
										? 'warning'
										: 'secondary'}
							>
								{ACTION_LABEL[e.action]}
							</Badge>
							{#if e.reason === 'dependency'}
								<Badge variant="outline">benötigt von {e.requiredBy.join(', ')}</Badge>
							{/if}
						</h3>
						<dl class="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
							<dt class="text-muted-foreground">Version</dt>
							<dd>{e.installedVersion ? `${e.installedVersion} → ` : ''}{e.version}</dd>
							<dt class="text-muted-foreground">Quelle</dt>
							<dd class="break-all">
								<code>{e.origin}</code>
								{#if e.commitUrl}
									<a
										class="ml-1 inline-flex items-center gap-1 text-link"
										href={e.commitUrl}
										target="_blank"
										rel="noopener noreferrer"
									>
										{e.commit?.slice(0, 10)}
										<ExternalLink class="size-3" aria-hidden="true" />
									</a>
								{/if}
							</dd>
							<dt class="text-muted-foreground">Core</dt>
							<dd><code>{e.coreRange}</code></dd>
							<dt class="text-muted-foreground">Rechte</dt>
							<dd>
								{#if e.permissionsAdded.length}neu: {e.permissionsAdded.join(', ')}{/if}
								{#if e.permissionsRemoved.length}
									<span class="block">entfallen: {e.permissionsRemoved.join(', ')}</span>
								{/if}
								{#if !e.permissionsAdded.length && !e.permissionsRemoved.length}unverändert{/if}
							</dd>
							<dt class="text-muted-foreground">Migrationen</dt>
							<dd>{e.newMigrations.length ? e.newMigrations.join(', ') : 'keine neuen'}</dd>
							<dt class="text-muted-foreground">npm-Pakete</dt>
							<dd>
								{#each e.npm as n (n.name)}
									<span class="mr-2 inline-block">
										<code>{n.name}@{n.version}</code>
										{n.status === 'core'
											? '(vom Core)'
											: n.status === 'new'
												? '(neu)'
												: '(Konflikt)'}
									</span>
								{:else}keine eigenen{/each}
							</dd>
							<dt class="text-muted-foreground">Dateien</dt>
							<dd>{e.fileCount}</dd>
						</dl>
						{#if e.blockers.length}
							<ul class="list-disc pl-5 text-sm text-destructive" role="alert">
								{#each e.blockers as b (b)}<li>{b}</li>{/each}
							</ul>
						{/if}
						{#if e.warnings.length}
							<ul class="list-disc pl-5 text-sm text-warning">
								{#each e.warnings as w (w)}<li>{w}</li>{/each}
							</ul>
						{/if}
					</section>
				{/each}

				{#if preview.satisfied.length}
					<p class="text-sm text-muted-foreground">
						Bereits installiert und passend:
						{preview.satisfied.map((s) => `${s.id} ${s.version}`).join(', ')}
					</p>
				{/if}
				{#if preview.recommended.length}
					<Alert.Root variant="info">
						<Alert.Title>Empfohlen (optional)</Alert.Title>
						<Alert.Description>
							<ul class="list-disc pl-5">
								{#each preview.recommended as r (r.id)}
									<li>
										<code>{r.id}</code> – erweitert {r.requiredBy}{r.available
											? ' (in dieser Quelle enthalten – oben zusätzlich auswählen)'
											: ''}
									</li>
								{/each}
							</ul>
						</Alert.Description>
					</Alert.Root>
				{/if}
				{#if preview.blockers.length}
					<Alert.Root variant="destructive">
						<Alert.Title>Installation nicht möglich</Alert.Title>
						<Alert.Description>
							<ul class="list-disc pl-5">
								{#each preview.blockers as b (b)}<li>{b}</li>{/each}
							</ul>
						</Alert.Description>
					</Alert.Root>
				{:else}
					<Alert.Root variant="warning">
						<Alert.Title>Modulcode läuft mit vollen Rechten</Alert.Title>
						<Alert.Description>
							Ein Modul kann alle Daten lesen und ändern und auf Zugangsdaten des Servers zugreifen.
							Installiere nur Module aus Quellen, denen du vertraust. Der angezeigte Commit wird
							festgehalten.
						</Alert.Description>
					</Alert.Root>
					<form method="POST" action="?/install" use:enhance={onInstall} class="space-y-4">
						<input type="hidden" name="token" value={preview.token} />
						<div class="flex items-start gap-2">
							<Checkbox
								id="install-accept"
								checked={accepted}
								onCheckedChange={(v) => (accepted = v === true)}
							/>
							<Label for="install-accept" class="leading-snug">
								Ich habe die Quelle geprüft und vertraue ihr.
							</Label>
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<AccountFields
								idPrefix="install"
								bind:password
								bind:totp
								twoFactorEnabled={data.twoFactorEnabled}
								disabled={busy !== null}
								errors={fields}
							/>
						</div>
						<input type="hidden" name="password" value={password} />
						<input type="hidden" name="totp" value={totp} />
						<Button
							type="submit"
							variant="destructive-solid"
							disabled={busy !== null || !canInstall || !password}
						>
							{busy === 'install' ? 'Installiert …' : 'Installieren'}
						</Button>
						{#if !preview.status.available && preview.status.reason}
							<p class="text-xs text-muted-foreground">{preview.status.reason}</p>
						{/if}
					</form>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if build && (waitingFor || ACTIVE.has(build.state))}
		<Card.Root aria-live="polite">
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					Neubau
					<Badge
						variant={build.state === 'done'
							? 'success'
							: build.state === 'failed'
								? 'destructive'
								: 'info'}>{STATE_LABEL[build.state] ?? build.state}</Badge
					>
				</Card.Title>
				<Card.Description>
					{#if offline}
						Der Server startet gerade neu …
					{:else if ACTIVE.has(build.state)}
						{build.step ?? 'Wartet'} … Das kann einige Minuten dauern; die Seite aktualisiert sich selbst.
					{:else}
						{build.message}
					{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#if build.logTail.length}
					<details open={build.state === 'failed'}>
						<summary class="cursor-pointer text-sm">Protokoll</summary>
						<pre
							class="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{build.logTail.join(
								'\n'
							)}</pre>
					</details>
				{/if}
				{#if build.state === 'done'}
					<Button href="/admin/modules" variant="outline">Zu den installierten Modulen</Button>
				{/if}
			</Card.Content>
		</Card.Root>
	{:else if result}
		<Alert.Root variant="success">
			<Alert.Title>Installiert</Alert.Title>
			<Alert.Description>
				{result.installed.map((i) => `${i.id} ${i.version}`).join(', ') || 'Keine Änderungen'}.
				{#if result.restartRequired}
					Die Module stehen nach dem Neustart des Servers unter „Installiert“ bereit und sind
					zunächst deaktiviert.
				{/if}
			</Alert.Description>
		</Alert.Root>
	{/if}

	<!-- Zugang -->
	<Card.Root>
		<Card.Header>
			<Card.Title>GitHub-Zugang und erlaubte Quellen</Card.Title>
			<Card.Description>
				Token nur für private Repositorys oder höhere Abruflimits nötig (Leserecht genügt).
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="POST" action="?/settings" use:enhance={onSettings} class="space-y-4">
				<FormField
					label="GitHub-Token"
					id="install-token"
					hint={data.hasToken
						? 'Ein Token ist hinterlegt. Leer lassen = beibehalten.'
						: 'Kein Token hinterlegt.'}
				>
					<Input id="install-token" name="token" type="password" autocomplete="off" />
				</FormField>
				{#if data.hasToken}
					<div class="flex items-center gap-2">
						<Checkbox id="install-clear" name="clearToken" />
						<Label for="install-clear">Token entfernen</Label>
					</div>
				{/if}
				<FormField
					label="Erlaubte Quellen"
					id="install-allowed"
					hint="Je Zeile owner/repo oder owner/*. Leer = alle GitHub-Quellen und ZIP-Dateien; sonst keine ZIP-Dateien."
				>
					<Textarea
						id="install-allowed"
						name="allowedSources"
						rows={3}
						value={data.allowedSources}
						class="font-mono text-sm"
					/>
				</FormField>
				<Button type="submit" variant="outline" disabled={busy !== null}>
					{busy === 'settings' ? 'Speichert …' : 'Speichern'}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>
</div>
