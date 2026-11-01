<script lang="ts">
	import { enhance } from '$app/forms';
	import { PageTitle } from '$lib/components/layout';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { FormField } from '$lib/components/layout';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import type { UpdateInfo } from '$lib/server/core/modules/install/manage';
	import AccountFields from '../backup/AccountFields.svelte';
	import { submitHandler } from '../_shared/form-utils';
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busyId = $state<string | null>(null);
	let errors = $state<Record<string, string>>({});

	// Updates, Entfernen, Wiederherstellen (Kalypzo Atrium)
	let updates = $state<UpdateInfo[] | null>(null);
	let checking = $state(false);
	let removeTarget = $state<{ id: string; name: string; hasCode: boolean } | null>(null);
	let deleteData = $state(false);
	let confirmId = $state('');
	let password = $state('');
	let totp = $state('');
	let fields = $state<Record<string, string>>({});
	let working = $state(false);

	const UPDATE_STATUS: Record<UpdateInfo['status'], string> = {
		current: 'admin-modules.updateStatus.current',
		update: 'admin-modules.updateStatus.update',
		'no-source': 'admin-modules.updateStatus.noSource',
		error: 'admin-modules.updateStatus.error'
	};

	/** Formular mit Feldfehlern, Ergebnis an `onok` */
	function action(onok: (d: Record<string, unknown>) => void): SubmitFunction {
		return () => {
			working = true;
			fields = {};
			return async ({ result }) => {
				working = false;
				if (result.type === 'success') {
					const d = (result.data ?? {}) as Record<string, unknown>;
					if (d.message) toast.success(String(d.message));
					onok(d);
					await invalidateAll();
				} else if (result.type === 'failure') {
					const d = (result.data ?? {}) as { message?: string; fields?: Record<string, string> };
					fields = d.fields ?? {};
					toast.error(d.message ?? t('admin-modules.actionFailed'));
				} else if (result.type === 'error') toast.error(t('admin-modules.unexpectedError'));
			};
		};
	}

	const onCheck: SubmitFunction = () => {
		checking = true;
		return async ({ result }) => {
			checking = false;
			if (result.type === 'success') updates = (result.data?.updates ?? []) as UpdateInfo[];
			else if (result.type === 'failure')
				toast.error(String(result.data?.message ?? t('admin-modules.error')));
		};
	};

	function openRemove(id: string, name: string, hasCode: boolean) {
		removeTarget = { id, name, hasCode };
		deleteData = !hasCode;
		confirmId = '';
		password = '';
		totp = '';
		fields = {};
	}

	const installHref = (u: UpdateInfo) =>
		`/admin/modules/install?url=${encodeURIComponent(u.source ?? '')}&select=${encodeURIComponent(u.id)}`;

	function handler(id: string) {
		return submitHandler({
			busy: (b) => (busyId = b ? id : null),
			error: (m) => (errors = { ...errors, [id]: m })
		});
	}
</script>

<PageTitle title={t('admin-modules.title')} />

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-muted-foreground">
			{t('admin-modules.intro')}
		</p>
		{#if data.canInstall}
			<form method="POST" action="?/checkUpdates" use:enhance={onCheck}>
				<Button type="submit" variant="outline" disabled={checking}>
					{checking ? t('admin-modules.checking') : t('admin-modules.checkUpdates')}
				</Button>
			</form>
		{/if}
	</div>

	{#if updates}
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('admin-modules.updates.title')}</Card.Title>
				<Card.Description>
					{t('admin-modules.updates.descriptionBefore')}
					<a class="text-link" href="/admin/backup">{t('admin-modules.updates.backupLink')}</a>{t(
						'admin-modules.updates.descriptionAfter'
					)}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if !updates.length}
					<p class="text-sm text-muted-foreground">
						{t('admin-modules.updates.none')}
					</p>
				{:else}
					<ul class="divide-y rounded-md border text-sm">
						{#each updates as u (u.id)}
							<li class="flex flex-wrap items-center gap-3 p-3">
								<span class="min-w-0 flex-1">
									<span class="font-medium">{u.name}</span>
									<code class="ml-1 text-xs text-muted-foreground">{u.id}</code>
									<span class="block text-xs text-muted-foreground">
										{u.installedVersion}{u.commit ? ` · ${u.commit.slice(0, 7)}` : ''}
										{#if u.status === 'update'}
											→ {u.latestVersion}{u.latestCommit ? ` · ${u.latestCommit.slice(0, 7)}` : ''}
										{/if}
										{#if u.message}· {u.message}{/if}
									</span>
								</span>
								<Badge
									variant={u.status === 'update'
										? 'info'
										: u.status === 'error'
											? 'destructive'
											: 'secondary'}>{t(UPDATE_STATUS[u.status])}</Badge
								>
								{#if u.status === 'update' && u.source}
									<Button href={installHref(u)} size="sm"
										>{t('admin-modules.updates.update')}</Button
									>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if data.drift.length}
		<Alert.Root variant="warning">
			<Alert.Title>{t('admin-modules.drift.title')}</Alert.Title>
			<Alert.Description class="space-y-3">
				<p>
					{t('admin-modules.drift.text', {
						list: data.drift.map((d) => `${d.id} ${d.version} (${d.source})`).join(', ')
					})}
				</p>
				{#if data.canInstall && data.drift.some((d) => d.restorable)}
					<form
						method="POST"
						action="?/restore"
						use:enhance={action(() => {})}
						class="grid max-w-xl gap-3 sm:grid-cols-2"
					>
						<AccountFields
							idPrefix="restore"
							bind:password
							bind:totp
							twoFactorEnabled={data.twoFactorEnabled}
							disabled={working}
							errors={fields}
						/>
						<input type="hidden" name="password" value={password} />
						<input type="hidden" name="totp" value={totp} />
						<div class="sm:col-span-2">
							<Button
								type="submit"
								disabled={working || !password || !data.installStatus.available}
							>
								{working ? t('admin-modules.pleaseWait') : t('admin-modules.drift.restore')}
							</Button>
							{#if !data.installStatus.available && data.installStatus.reason}
								<p class="mt-1 text-xs">{data.installStatus.reason}</p>
							{/if}
						</div>
					</form>
				{/if}
			</Alert.Description>
		</Alert.Root>
	{/if}

	{#if data.problems.length}
		<section class="space-y-3" aria-labelledby="module-problems">
			<h2 id="module-problems" class="text-section">{t('admin-modules.problems.title')}</h2>
			<Alert.Root variant="warning">
				<Alert.Title>{t('admin-modules.problems.alertTitle')}</Alert.Title>
				<Alert.Description>
					{t('admin-modules.problems.alertText')}
				</Alert.Description>
			</Alert.Root>
			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{#each data.problems as p (p.id)}
					<Card.Root>
						<Card.Header>
							<Card.Title level={3} class="flex flex-wrap items-center gap-2">
								{p.name}
								{#if p.kind === 'broken'}<Badge variant="destructive"
										>{t('admin-modules.problems.broken')}</Badge
									>{:else}<Badge variant="warning">{t('admin-modules.problems.missing')}</Badge
									>{/if}
								{#if p.enabled}<Badge variant="outline"
										>{t('admin-modules.problems.wasActive')}</Badge
									>{/if}
							</Card.Title>
						</Card.Header>
						<Card.Content class="space-y-2 text-sm">
							<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
								<dt class="text-muted-foreground">{t('admin-modules.id')}</dt>
								<dd><code>{p.id}</code></dd>
								<dt class="text-muted-foreground">{t('admin-modules.version')}</dt>
								<dd>{p.version ?? '–'}</dd>
							</dl>
							<p class={p.kind === 'broken' ? 'text-destructive' : 'text-muted-foreground'}>
								{p.reason}
							</p>
							{#if data.canInstall && p.kind === 'missing' && !p.enabled}
								<Button variant="outline" size="sm" onclick={() => openRemove(p.id, p.name, false)}>
									{t('admin-modules.problems.deleteData')}
								</Button>
							{/if}
						</Card.Content>
					</Card.Root>
				{/each}
			</div>
		</section>
	{/if}

	{#if !data.modules.length}
		<Card.Root>
			<Card.Content class="py-10 text-center text-muted-foreground">
				{t('admin-modules.empty')}
			</Card.Content>
		</Card.Root>
	{/if}

	<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
		{#each data.modules as m (m.id)}
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex flex-wrap items-center gap-2">
						{m.name}
						{#if m.enabled}<Badge>{t('admin-modules.active')}</Badge>{:else}<Badge
								variant="secondary">{t('admin-modules.inactive')}</Badge
							>{/if}
					</Card.Title>
					<Card.Description>{m.description || t('admin-modules.noDescription')}</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-3 text-sm">
					<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
						<dt class="text-muted-foreground">{t('admin-modules.id')}</dt>
						<dd><code>{m.id}</code></dd>
						<dt class="text-muted-foreground">{t('admin-modules.version')}</dt>
						<dd>
							{m.version}
							{#if m.installedVersion && m.installedVersion !== m.version}
								<span class="text-muted-foreground"
									>{t('admin-modules.installedVersion', { version: m.installedVersion })}</span
								>
							{/if}
						</dd>
						<dt class="text-muted-foreground">{t('admin-modules.dependencies')}</dt>
						<dd>{m.dependencies.length ? m.dependencies.join(', ') : '–'}</dd>
						<dt class="text-muted-foreground">{t('admin-modules.permissions')}</dt>
						<dd>{m.permissionCount}</dd>
						<dt class="text-muted-foreground">{t('admin-modules.origin')}</dt>
						<dd class="break-all">
							{#if data.origins[m.id]}
								{data.origins[m.id]!.label}{#if data.origins[m.id]!.commit}
									<code class="ml-1 text-xs text-muted-foreground"
										>{data.origins[m.id]!.commit!.slice(0, 7)}</code
									>{/if}
							{:else}
								{t('admin-modules.inBuild')}
							{/if}
						</dd>
					</dl>

					{#if m.missingDependencies.length}
						<p class="text-destructive" role="alert">
							{t('admin-modules.missingModules', { list: m.missingDependencies.join(', ') })}
						</p>
					{/if}
					{#if m.dependents.length}
						<p class="text-muted-foreground">
							{t('admin-modules.requiredByActive', { list: m.dependents.join(', ') })}
						</p>
					{/if}
					{#if errors[m.id]}<p class="text-destructive" role="alert">{errors[m.id]}</p>{/if}

					<div class="flex flex-wrap items-center gap-2">
						{#if data.canManage}
							<form
								method="POST"
								action={m.enabled ? '?/disable' : '?/enable'}
								use:enhance={handler(m.id)}
							>
								<input type="hidden" name="id" value={m.id} />
								<Button
									type="submit"
									variant={m.enabled ? 'outline' : 'default'}
									disabled={busyId === m.id || (m.enabled && m.dependents.length > 0)}
								>
									{busyId === m.id
										? t('admin-modules.pleaseWait')
										: m.enabled
											? t('admin-modules.deactivate')
											: t('admin-modules.activate')}
								</Button>
							</form>
						{/if}
						{#if data.canInstall && !m.enabled && !m.requiredBy.length}
							<Button variant="ghost" onclick={() => openRemove(m.id, m.name, true)}>
								{t('admin-modules.removeEllipsis')}
							</Button>
						{/if}
					</div>
					{#if data.canInstall && !m.enabled && m.requiredBy.length}
						<p class="text-xs text-muted-foreground">
							{t('admin-modules.removeBlocked', { list: m.requiredBy.join(', ') })}
						</p>
					{/if}
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
</div>

<Dialog.Root open={!!removeTarget} onOpenChange={(o) => !o && (removeTarget = null)}>
	<Dialog.Content class="sm:max-w-lg">
		{#if removeTarget}
			<Dialog.Header>
				<Dialog.Title>
					{removeTarget.hasCode
						? t('admin-modules.remove.titleCode', { name: removeTarget.name })
						: t('admin-modules.remove.titleData', { name: removeTarget.name })}
				</Dialog.Title>
				<Dialog.Description>
					{#if removeTarget.hasCode}
						{data.installStatus.mode === 'supervisor'
							? t('admin-modules.remove.descriptionCodeRebuild')
							: t('admin-modules.remove.descriptionCode')}
					{:else}
						{t('admin-modules.remove.descriptionData')}
					{/if}
				</Dialog.Description>
			</Dialog.Header>
			<form
				method="POST"
				action="?/uninstall"
				use:enhance={action(() => (removeTarget = null))}
				class="space-y-4"
			>
				<input type="hidden" name="id" value={removeTarget.id} />
				{#if removeTarget.hasCode}
					<div class="flex items-start gap-2">
						<Checkbox
							id="rm-delete"
							name="deleteData"
							checked={deleteData}
							onCheckedChange={(v) => (deleteData = v === true)}
						/>
						<Label for="rm-delete" class="leading-snug">
							{t('admin-modules.remove.deleteData')}
						</Label>
					</div>
				{:else}
					<input type="hidden" name="deleteData" value="on" />
				{/if}
				{#if deleteData}
					<FormField
						label={t('admin-modules.remove.confirmLabel', { id: removeTarget.id })}
						id="rm-confirm"
						error={fields.confirmId}
					>
						<Input
							id="rm-confirm"
							name="confirmId"
							bind:value={confirmId}
							autocomplete="off"
							class="font-mono"
						/>
					</FormField>
				{/if}
				<AccountFields
					idPrefix="rm"
					bind:password
					bind:totp
					twoFactorEnabled={data.twoFactorEnabled}
					disabled={working}
					errors={fields}
				/>
				<input type="hidden" name="password" value={password} />
				<input type="hidden" name="totp" value={totp} />
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (removeTarget = null)}>
						{t('admin-modules.remove.cancel')}
					</Button>
					<Button
						type="submit"
						variant="destructive-solid"
						disabled={working || !password || (deleteData && confirmId !== removeTarget.id)}
					>
						{working
							? t('admin-modules.pleaseWait')
							: deleteData
								? t('admin-modules.remove.delete')
								: t('admin-modules.remove.remove')}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
