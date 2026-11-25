<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { SelectField } from '$lib/components/ui/select-field';
	import { formatDateTime } from '$lib/i18n/intl';
	import { t } from '$lib/i18n';
	import type { UpdateInfo } from '$lib/server/core/modules/install/updates';
	import type { UpdateStatus } from '$lib/server/core/modules/install/update-rules';

	let { updates: all }: { updates: UpdateInfo[] } = $props();
	/** Nur Module aus GitHub – ZIP-Module aktualisiert man mit einer neuen Datei */
	const updates = $derived(all.filter((u) => u.source));

	let selected = $state<string[]>([]);
	let busy = $state<string | null>(null);

	const STATUS: Record<UpdateStatus, string> = {
		current: 'admin-modules.updateStatus.current',
		unchecked: 'admin-modules.updateStatus.unchecked',
		update: 'admin-modules.updateStatus.update',
		changed: 'admin-modules.updateStatus.changed',
		incompatible: 'admin-modules.updateStatus.incompatible',
		ignored: 'admin-modules.updateStatus.ignored',
		'no-source': 'admin-modules.updateStatus.noSource',
		error: 'admin-modules.updateStatus.error'
	};
	const VARIANT: Record<
		UpdateStatus,
		'info' | 'warning' | 'destructive' | 'secondary' | 'success'
	> = {
		current: 'success',
		unchecked: 'secondary',
		update: 'info',
		changed: 'info',
		incompatible: 'warning',
		ignored: 'secondary',
		'no-source': 'secondary',
		error: 'destructive'
	};

	const installable = (u: UpdateInfo) => u.status === 'update' || u.status === 'changed';
	const available = $derived(updates.filter(installable));
	/** Auswahl nur aus aktuell installierbaren Einträgen (nach einer neuen Prüfung kann sich das ändern) */
	const chosen = $derived(selected.filter((id) => available.some((u) => u.id === id)));
	const lastChecked = $derived(
		updates
			.map((u) => u.checkedAt)
			.filter((c): c is string => !!c)
			.sort()
			.pop() ?? null
	);
	const channelOptions = $derived([
		{ value: 'release', label: t('admin-modules.updates.channelRelease') },
		{ value: 'branch', label: t('admin-modules.updates.channelBranch') }
	]);

	const updateHref = (ids: string[]) =>
		`/admin/modules/install?update=${encodeURIComponent(ids.join(','))}`;

	/** Kanalwahl: sofort speichern (eigenes Formular je Modul) */
	let channelDraft = $state<Record<string, string>>({});
	const channelForms: Record<string, HTMLFormElement> = $state({});
	async function changeChannel(u: UpdateInfo, v: string | null) {
		if (!v || v === (channelDraft[u.id] ?? u.channel)) return;
		channelDraft = { ...channelDraft, [u.id]: v };
		await tick();
		channelForms[u.id]?.requestSubmit();
	}

	function toggle(id: string, on: boolean) {
		selected = on ? [...new Set([...selected, id])] : selected.filter((s) => s !== id);
	}

	function submit(key: string): SubmitFunction {
		return () => {
			busy = key;
			return async ({ result }) => {
				busy = null;
				if (result.type === 'success') {
					const msg = (result.data as { message?: string } | undefined)?.message;
					if (msg) toast.success(msg);
					await invalidateAll();
				} else if (result.type === 'failure') {
					// Abgelehnte Kanalwahl zurücknehmen (Anzeige wieder wie gespeichert)
					channelDraft = {};
					toast.error(
						String(
							(result.data as { message?: string } | undefined)?.message ?? t('admin-modules.error')
						)
					);
				} else if (result.type === 'error') toast.error(t('admin-modules.unexpectedError'));
			};
		};
	}

	function versionLine(u: UpdateInfo): string {
		const from = `${u.installedVersion}${u.commit ? ` · ${u.commit.slice(0, 7)}` : ''}`;
		if (!installable(u) && u.status !== 'incompatible' && u.status !== 'ignored') return from;
		const to = `${u.latestVersion ?? '?'}${u.latestRef && u.latestRef !== u.latestVersion ? ` (${u.latestRef})` : ''}`;
		return `${from} → ${to}`;
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{t('admin-modules.updates.title')}</Card.Title>
		<Card.Description>
			{t('admin-modules.updates.descriptionBefore')}
			<a class="text-link" href="/admin/backup">{t('admin-modules.updates.backupLink')}</a>{t(
				'admin-modules.updates.descriptionAfter'
			)}
			{#if lastChecked}
				<span class="block text-xs">
					{t('admin-modules.updates.lastChecked', { at: formatDateTime(lastChecked) })}
				</span>
			{:else}
				<span class="block text-xs">{t('admin-modules.updates.neverChecked')}</span>
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		<div class="flex flex-wrap items-center gap-2">
			<form method="POST" action="?/checkUpdates" use:enhance={submit('check')}>
				<Button type="submit" variant="outline" disabled={busy !== null}>
					{busy === 'check' ? t('admin-modules.checking') : t('admin-modules.checkUpdates')}
				</Button>
			</form>
			{#if available.length}
				{#if chosen.length}
					<Button href={updateHref(chosen)}>
						{t('admin-modules.updates.updateSelected', { count: chosen.length })}
					</Button>
				{/if}
				<Button href={updateHref(available.map((u) => u.id))} variant="outline">
					{t('admin-modules.updates.updateAll', { count: available.length })}
				</Button>
			{/if}
		</div>

		<ul
			class="divide-y rounded-md border text-sm"
			aria-label={t('admin-modules.updates.listLabel')}
		>
			{#each updates as u (u.id)}
				<li class="space-y-2 p-3">
					<div class="flex flex-wrap items-start gap-3">
						{#if installable(u)}
							<Checkbox
								id="upd-{u.id}"
								checked={chosen.includes(u.id)}
								onCheckedChange={(v) => toggle(u.id, v === true)}
								aria-label={t('admin-modules.updates.select', { name: u.name })}
								class="mt-0.5"
							/>
						{:else}
							<!-- gleiche Einrückung wie Zeilen mit Auswahl -->
							<span class="size-4 shrink-0" aria-hidden="true"></span>
						{/if}
						<div class="min-w-0 flex-1">
							<span class="font-medium">{u.name}</span>
							<code class="ml-1 text-xs text-muted-foreground">{u.id}</code>
							<span class="block text-xs break-words text-muted-foreground tabular-nums">
								{versionLine(u)}
							</span>
							{#if u.message}
								<span class="block text-xs text-muted-foreground">{u.message}</span>
							{/if}
							{#if u.newerInstalled}
								<span class="block text-xs text-muted-foreground"
									>{t('admin-modules.updates.newerInstalled')}</span
								>
							{/if}
						</div>
						<Badge variant={VARIANT[u.status]}>{t(STATUS[u.status])}</Badge>
					</div>

					{#if u.source}
						<div class="flex flex-wrap items-center gap-2">
							<form
								method="POST"
								action="?/setChannel"
								use:enhance={submit(`ch-${u.id}`)}
								bind:this={channelForms[u.id]}
							>
								<input type="hidden" name="id" value={u.id} />
								<input type="hidden" name="channel" value={channelDraft[u.id] ?? u.channel} />
								<SelectField
									options={channelOptions}
									value={channelDraft[u.id] ?? u.channel}
									label={t('admin-modules.updates.channel', { name: u.name })}
									size="sm"
									class="w-48"
									disabled={busy !== null}
									onchange={(v) => changeChannel(u, v)}
								/>
							</form>
							{#if installable(u) || u.status === 'incompatible'}
								<form method="POST" action="?/ignoreUpdate" use:enhance={submit(`ig-${u.id}`)}>
									<input type="hidden" name="id" value={u.id} />
									<Button type="submit" size="sm" variant="ghost" disabled={busy !== null}>
										{t('admin-modules.updates.ignore')}
									</Button>
								</form>
							{:else if u.status === 'ignored'}
								<form method="POST" action="?/ignoreUpdate" use:enhance={submit(`ig-${u.id}`)}>
									<input type="hidden" name="id" value={u.id} />
									<input type="hidden" name="ignore" value="off" />
									<Button type="submit" size="sm" variant="ghost" disabled={busy !== null}>
										{t('admin-modules.updates.unignore')}
									</Button>
								</form>
							{/if}
							{#if u.latestUrl && (installable(u) || u.status === 'incompatible' || u.status === 'ignored')}
								<a
									class="inline-flex items-center gap-1 text-xs text-link"
									href={u.latestUrl}
									target="_blank"
									rel="noopener noreferrer"
								>
									{t('admin-modules.updates.onGithub')}
									<ExternalLink class="size-3" aria-hidden="true" />
								</a>
							{/if}
						</div>
					{/if}

					{#if installable(u) || u.status === 'incompatible'}
						<details class="rounded-md bg-muted/50 p-2">
							<summary class="cursor-pointer text-xs font-medium">
								{t('admin-modules.updates.details')}
							</summary>
							<div class="mt-2 space-y-2 text-xs">
								{#if u.changelog.length}
									{#each u.changelog as c (c.version)}
										<div>
											<p class="font-medium">{c.version}</p>
											<p class="whitespace-pre-wrap text-muted-foreground">{c.notes}</p>
										</div>
									{/each}
								{:else if u.commits.length}
									<ul class="list-disc pl-4 text-muted-foreground">
										{#each u.commits as c (c.sha)}
											<li><code>{c.sha.slice(0, 7)}</code> {c.message}</li>
										{/each}
									</ul>
								{:else}
									<p class="text-muted-foreground">{t('admin-modules.updates.noNotes')}</p>
								{/if}
								{#if u.permissionsAdded.length}
									<p>
										{t('admin-modules.updates.permissionsAdded', {
											list: u.permissionsAdded.join(', ')
										})}
									</p>
								{/if}
								{#if u.newMigrations.length}
									<p>
										{t('admin-modules.updates.newMigrations', { list: u.newMigrations.join(', ') })}
									</p>
								{/if}
								{#if u.npmNew.length}
									<p>{t('admin-modules.updates.npmNew', { list: u.npmNew.join(', ') })}</p>
								{/if}
								{#if u.blockers.length}
									<ul class="list-disc pl-4 text-destructive" role="alert">
										{#each u.blockers as b (b)}<li>{b}</li>{/each}
									</ul>
								{/if}
							</div>
						</details>
					{/if}
				</li>
			{/each}
		</ul>
	</Card.Content>
</Card.Root>
