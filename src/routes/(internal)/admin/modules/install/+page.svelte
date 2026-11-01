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
	import { t } from '$lib/i18n';
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
		queued: 'admin-modules.install.state.queued',
		building: 'admin-modules.install.state.building',
		verifying: 'admin-modules.install.state.verifying',
		restarting: 'admin-modules.install.state.restarting',
		done: 'admin-modules.install.state.done',
		failed: 'admin-modules.install.state.failed',
		idle: 'admin-modules.install.state.idle'
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
				if (build.state === 'done') toast.success(t('admin-modules.install.buildDone'));
				else if (build.state === 'failed') toast.error(t('admin-modules.install.buildFailed'));
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
		install: 'admin-modules.install.action.install',
		update: 'admin-modules.install.action.update',
		reinstall: 'admin-modules.install.action.reinstall',
		unchanged: 'admin-modules.install.action.unchanged',
		downgrade: 'admin-modules.install.action.downgrade'
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
					toast.error(d.message ?? t('admin-modules.install.actionFailed'));
				} else if (r.type === 'error') toast.error(t('admin-modules.install.unexpectedError'));
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
		else toast.success(t('admin-modules.install.installed'));
	});
	const onSettings = submit('settings', () => toast.success(t('admin-modules.install.saved')));

	function toggle(id: string, on: boolean) {
		selected = on ? [...new Set([...selected, id])] : selected.filter((s) => s !== id);
	}

	const canInstall = $derived(
		!!preview && !preview.blockers.length && preview.status.available && accepted
	);
</script>

<PageTitle title={t('admin-modules.install.title')} />

<div class="space-y-6">
	{#if data.status.reason}
		<Alert.Root variant="info">
			<Alert.Title>{t('admin-modules.install.previewOnly')}</Alert.Title>
			<Alert.Description>{data.status.reason}</Alert.Description>
		</Alert.Root>
	{/if}

	<!-- 1. Quelle -->
	<Card.Root>
		<Card.Header>
			<Card.Title>{t('admin-modules.install.sourceTitle')}</Card.Title>
			<Card.Description>
				{t('admin-modules.install.sourceDescriptionBefore')}
				<code>atrium-modules.json</code>{t('admin-modules.install.sourceDescriptionAfter')}
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
					label={t('admin-modules.install.githubLink')}
					id="install-url"
					error={fields.url}
					hint={t('admin-modules.install.githubHint')}
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
					label={t('admin-modules.install.zipLabel')}
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
					{busy === 'inspect'
						? t('admin-modules.install.loading')
						: t('admin-modules.install.loadSource')}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<!-- 2. Auswahl -->
	{#if inspection}
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('admin-modules.install.selectTitle')}</Card.Title>
				<Card.Description>
					{inspection.catalogName ?? inspection.label}
					{#if inspection.commit}
						· {t('admin-modules.install.commit')} <code>{inspection.commit.slice(0, 10)}</code>{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form method="POST" action="?/preview" use:enhance={onPreview} class="space-y-4">
					<input type="hidden" name="sourceToken" value={inspection.token} />
					<ul
						class="divide-y rounded-md border"
						aria-label={t('admin-modules.install.sourceModules')}
					>
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
											<Badge variant="secondary"
												>{t('admin-modules.install.installedBadge', {
													version: m.installedVersion
												})}</Badge
											>
										{/if}
									</Label>
									{#if m.description}<p class="text-sm text-muted-foreground">
											{m.description}
										</p>{/if}
									{#if m.dependencies.length}
										<p class="text-xs text-muted-foreground">
											{t('admin-modules.install.needs', { list: m.dependencies.join(', ') })}
										</p>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
					{#if inspection.problems.length}
						<Alert.Root variant="warning">
							<Alert.Title>{t('admin-modules.install.unreadable')}</Alert.Title>
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
						{busy === 'preview'
							? t('admin-modules.install.checking')
							: t('admin-modules.install.showPreview')}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}

	<!-- 3. Vorschau -->
	{#if preview}
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('admin-modules.install.previewTitle')}</Card.Title>
				<Card.Description>
					{t('admin-modules.install.previewDescription')}
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#each preview.entries as e (e.id)}
					<section
						class="space-y-2 rounded-md border p-3"
						aria-label={t('admin-modules.install.moduleLabel', { name: e.name })}
					>
						<h3 class="flex flex-wrap items-center gap-2 font-medium">
							{e.name} <code class="text-xs text-muted-foreground">{e.id}</code>
							<Badge
								variant={e.action === 'install'
									? 'info'
									: e.action === 'downgrade'
										? 'warning'
										: 'secondary'}
							>
								{t(ACTION_LABEL[e.action] ?? e.action)}
							</Badge>
							{#if e.reason === 'dependency'}
								<Badge variant="outline"
									>{t('admin-modules.install.requiredBy', { list: e.requiredBy.join(', ') })}</Badge
								>
							{/if}
						</h3>
						<dl class="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
							<dt class="text-muted-foreground">{t('admin-modules.install.version')}</dt>
							<dd>{e.installedVersion ? `${e.installedVersion} → ` : ''}{e.version}</dd>
							<dt class="text-muted-foreground">{t('admin-modules.install.source')}</dt>
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
							<dt class="text-muted-foreground">{t('admin-modules.install.core')}</dt>
							<dd><code>{e.coreRange}</code></dd>
							<dt class="text-muted-foreground">{t('admin-modules.install.permissions')}</dt>
							<dd>
								{#if e.permissionsAdded.length}{t('admin-modules.install.permissionsAdded', {
										list: e.permissionsAdded.join(', ')
									})}{/if}
								{#if e.permissionsRemoved.length}
									<span class="block"
										>{t('admin-modules.install.permissionsRemoved', {
											list: e.permissionsRemoved.join(', ')
										})}</span
									>
								{/if}
								{#if !e.permissionsAdded.length && !e.permissionsRemoved.length}{t(
										'admin-modules.install.unchanged'
									)}{/if}
							</dd>
							<dt class="text-muted-foreground">{t('admin-modules.install.migrations')}</dt>
							<dd>
								{e.newMigrations.length
									? e.newMigrations.join(', ')
									: t('admin-modules.install.noNewMigrations')}
							</dd>
							<dt class="text-muted-foreground">{t('admin-modules.install.npm')}</dt>
							<dd>
								{#each e.npm as n (n.name)}
									<span class="mr-2 inline-block">
										<code>{n.name}@{n.version}</code>
										{n.status === 'core'
											? t('admin-modules.install.npmCore')
											: n.status === 'new'
												? t('admin-modules.install.npmNew')
												: t('admin-modules.install.npmConflict')}
									</span>
								{:else}{t('admin-modules.install.npmNone')}{/each}
							</dd>
							<dt class="text-muted-foreground">{t('admin-modules.install.files')}</dt>
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
						{t('admin-modules.install.satisfied', {
							list: preview.satisfied.map((s) => `${s.id} ${s.version}`).join(', ')
						})}
					</p>
				{/if}
				{#if preview.recommended.length}
					<Alert.Root variant="info">
						<Alert.Title>{t('admin-modules.install.recommendedTitle')}</Alert.Title>
						<Alert.Description>
							<ul class="list-disc pl-5">
								{#each preview.recommended as r (r.id)}
									<li>
										<code>{r.id}</code>
										{t(
											r.available
												? 'admin-modules.install.recommendedAvailable'
												: 'admin-modules.install.recommendedItem',
											{ module: r.requiredBy }
										)}
									</li>
								{/each}
							</ul>
						</Alert.Description>
					</Alert.Root>
				{/if}
				{#if preview.blockers.length}
					<Alert.Root variant="destructive">
						<Alert.Title>{t('admin-modules.install.blockedTitle')}</Alert.Title>
						<Alert.Description>
							<ul class="list-disc pl-5">
								{#each preview.blockers as b (b)}<li>{b}</li>{/each}
							</ul>
						</Alert.Description>
					</Alert.Root>
				{:else}
					<Alert.Root variant="warning">
						<Alert.Title>{t('admin-modules.install.warningTitle')}</Alert.Title>
						<Alert.Description>
							{t('admin-modules.install.warningText')}
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
								{t('admin-modules.install.accept')}
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
							{busy === 'install'
								? t('admin-modules.install.installing')
								: t('admin-modules.install.install')}
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
					{t('admin-modules.install.rebuild')}
					<Badge
						variant={build.state === 'done'
							? 'success'
							: build.state === 'failed'
								? 'destructive'
								: 'info'}
						>{STATE_LABEL[build.state] ? t(STATE_LABEL[build.state]!) : build.state}</Badge
					>
				</Card.Title>
				<Card.Description>
					{#if offline}
						{t('admin-modules.install.restarting')}
					{:else if ACTIVE.has(build.state)}
						{t('admin-modules.install.progress', {
							step: build.step ?? t('admin-modules.install.waiting')
						})}
					{:else}
						{build.message}
					{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#if build.logTail.length}
					<details open={build.state === 'failed'}>
						<summary class="cursor-pointer text-sm">{t('admin-modules.install.log')}</summary>
						<pre
							class="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{build.logTail.join(
								'\n'
							)}</pre>
					</details>
				{/if}
				{#if build.state === 'done'}
					<Button href="/admin/modules" variant="outline"
						>{t('admin-modules.install.toInstalled')}</Button
					>
				{/if}
			</Card.Content>
		</Card.Root>
	{:else if result}
		<Alert.Root variant="success">
			<Alert.Title>{t('admin-modules.install.doneTitle')}</Alert.Title>
			<Alert.Description>
				{result.installed.map((i) => `${i.id} ${i.version}`).join(', ') ||
					t('admin-modules.install.noChanges')}.
				{#if result.restartRequired}
					{t('admin-modules.install.restartHint')}
				{/if}
			</Alert.Description>
		</Alert.Root>
	{/if}

	<!-- Zugang -->
	<Card.Root>
		<Card.Header>
			<Card.Title>{t('admin-modules.install.accessTitle')}</Card.Title>
			<Card.Description>
				{t('admin-modules.install.accessDescription')}
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="POST" action="?/settings" use:enhance={onSettings} class="space-y-4">
				<FormField
					label={t('admin-modules.install.token')}
					id="install-token"
					hint={data.hasToken
						? t('admin-modules.install.tokenSet')
						: t('admin-modules.install.tokenNotSet')}
				>
					<Input id="install-token" name="token" type="password" autocomplete="off" />
				</FormField>
				{#if data.hasToken}
					<div class="flex items-center gap-2">
						<Checkbox id="install-clear" name="clearToken" />
						<Label for="install-clear">{t('admin-modules.install.clearToken')}</Label>
					</div>
				{/if}
				<FormField
					label={t('admin-modules.install.allowedSources')}
					id="install-allowed"
					hint={t('admin-modules.install.allowedSourcesHint')}
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
					{busy === 'settings'
						? t('admin-modules.install.saving')
						: t('admin-modules.install.save')}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>
</div>
