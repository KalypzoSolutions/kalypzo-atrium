<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import type { SubmitFunction } from '@sveltejs/kit';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import DramaIcon from '@lucide/svelte/icons/drama';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import {
		ConfirmDialog,
		DataTable,
		EntityAvatar,
		FormField,
		PageHeader,
		PageTitle,
		Pagination
	} from '$lib/components/layout';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { SelectField } from '$lib/components/ui/select-field';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Textarea } from '$lib/components/ui/textarea';
	import { t } from '$lib/i18n';
	import {
		formatBytes,
		formatDate,
		formatDateTime,
		formatNumber,
		formatRelative
	} from '$lib/i18n/intl';
	import { describeUserAgent } from '$lib/user-agent';
	import ActivityChart from './ActivityChart.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const u = $derived(data.user);
	const s = $derived(data.stats);

	const TABS = ['overview', 'activity', 'sessions', 'security', 'permissions'] as const;
	type Tab = (typeof TABS)[number];
	const requested = $derived(page.url.searchParams.get('tab'));
	let tab = $state<Tab>('overview');
	$effect.pre(() => {
		const r = requested as Tab | null;
		tab = r && TABS.includes(r) ? r : 'overview';
	});
	function selectTab(v: string) {
		tab = v as Tab;
		const url = new URL(page.url);
		if (v === 'overview') url.searchParams.delete('tab');
		else url.searchParams.set('tab', v);
		url.searchParams.delete('apage');
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	let busy = $state(false);
	let resetLink = $state<string | null>(null);
	let generated = $state<string | null>(null);
	let passwordOpen = $state(false);
	let passwordMode = $state<'generate' | 'manual'>('generate');
	let impersonateOpen = $state(false);
	let impersonateMinutes = $state<string | null>('30');
	let impersonateError = $state<{ message: string; field: string | null } | null>(null);
	let confirm = $state<{
		title: string;
		description: string;
		label: string;
		form: HTMLFormElement | null;
		destructive?: boolean;
	} | null>(null);

	const rel = (v: string | null) => (v ? formatRelative(new Date(v)) : t('admin-users.never'));
	const dt = (v: string | null) => (v ? formatDateTime(new Date(v)) : undefined);

	const submit =
		(after?: (data: Record<string, unknown>) => void): SubmitFunction =>
		() => {
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				confirm = null;
				if (result.type === 'success') {
					toast.success((result.data?.message as string) ?? t('admin-users.saved'));
					after?.(result.data ?? {});
					await invalidateAll();
				} else if (result.type === 'failure') {
					toast.error((result.data?.message as string) ?? t('admin-users.actionFailed'));
				} else {
					await update();
				}
			};
		};

	const impersonateSubmit: SubmitFunction = () => {
		busy = true;
		impersonateError = null;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'failure') {
				impersonateError = {
					message: (result.data?.message as string) ?? t('admin-users.actionFailed'),
					field: (result.data?.field as string | null) ?? null
				};
			} else {
				// Redirect: die ganze App lädt neu als Zielperson
				await update();
			}
		};
	};

	function ask(
		form: HTMLFormElement | null,
		title: string,
		description: string,
		label: string,
		destructive = false
	) {
		confirm = { form, title, description, label, destructive };
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(t('admin-users.detail.copied'));
		} catch {
			toast.error(t('admin-users.detail.copyFailed'));
		}
	}

	// Rechte nach Modul gruppiert
	const permissionGroups = $derived.by(() => {
		const map = new Map<string, typeof data.permissions>();
		for (const p of data.permissions) map.set(p.moduleId, [...(map.get(p.moduleId) ?? []), p]);
		return [...map.entries()];
	});

	const editHref = $derived(`/admin/users?q=${encodeURIComponent(u.email)}&edit=${u.id}`);

	let sendResetForm = $state<HTMLFormElement | null>(null);
	let resetTwoFactorForm = $state<HTMLFormElement | null>(null);
	let revokeAllForm = $state<HTMLFormElement | null>(null);
	let setActiveForm = $state<HTMLFormElement | null>(null);
	let deleteForm = $state<HTMLFormElement | null>(null);
	let inviteForm = $state<HTMLFormElement | null>(null);
</script>

<PageTitle title={u.name} />

<div class="space-y-6">
	<a
		href="/admin/users"
		class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
	>
		<ArrowLeftIcon class="size-4" aria-hidden="true" />{t('admin-users.detail.back')}
	</a>

	<PageHeader title={u.name} description={u.email}>
		{#snippet actions()}
			{#if data.can.impersonate}
				<Button
					variant="outline"
					onclick={() => ((impersonateError = null), (impersonateOpen = true))}
					><DramaIcon />{t('admin-users.detail.impersonate')}</Button
				>
			{/if}
			{#if data.can.edit}
				<Button href={editHref}><PencilIcon />{t('admin-users.edit')}</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<div class="-mt-3 flex flex-wrap items-center gap-3">
		<EntityAvatar name={u.name} src={u.image} size={40} />
		<div class="flex flex-wrap gap-1">
			{#if u.active}<Badge variant="success">{t('admin-users.active')}</Badge>{:else}<Badge
					variant="destructive">{t('admin-users.inactive')}</Badge
				>{/if}
			{#if !u.emailVerified}<Badge variant="warning">{t('admin-users.emailUnverified')}</Badge>{/if}
			<Badge variant="outline"
				>{u.twoFactorEnabled ? t('admin-users.twoFactorOn') : t('admin-users.twoFactorOff')}</Badge
			>
			{#if u.mustChangePassword}<Badge variant="info">{t('admin-users.detail.mustChange')}</Badge
				>{/if}
			{#if data.targetIsAdmin}<Badge variant="outline"
					>{t('admin-users.detail.administrator')}</Badge
				>{/if}
			{#each u.roles as r (r.id)}<Badge variant="secondary">{r.name}</Badge>{/each}
		</div>
	</div>

	{#if data.self}
		<Alert variant="info">
			<AlertDescription>
				{t('admin-users.detail.selfHint')}
				<a class="text-link underline" href="/profile?tab=security"
					>{t('admin-users.detail.toProfile')}</a
				>
			</AlertDescription>
		</Alert>
	{:else if !data.manageable}
		<Alert variant="warning"
			><AlertDescription>{t('admin-users.lockedHint')}</AlertDescription></Alert
		>
	{/if}

	<Tabs.Root value={tab} onValueChange={selectTab}>
		<Tabs.List variant="line" class="w-full justify-start">
			<Tabs.Trigger value="overview" class="flex-none"
				>{t('admin-users.detail.tabs.overview')}</Tabs.Trigger
			>
			{#if data.activity}
				<Tabs.Trigger value="activity" class="flex-none"
					>{t('admin-users.detail.tabs.activity')}</Tabs.Trigger
				>
			{/if}
			<Tabs.Trigger value="sessions" class="flex-none">
				{t('admin-users.detail.tabs.sessions')}
				<span class="text-muted-foreground tabular-nums">{data.sessions.length}</span>
			</Tabs.Trigger>
			<Tabs.Trigger value="security" class="flex-none"
				>{t('admin-users.detail.tabs.security')}</Tabs.Trigger
			>
			<Tabs.Trigger value="permissions" class="flex-none">
				{t('admin-users.detail.tabs.permissions')}
				<span class="text-muted-foreground tabular-nums">{data.permissions.length}</span>
			</Tabs.Trigger>
		</Tabs.List>

		<!-- Übersicht -->
		<Tabs.Content value="overview" class="space-y-6 pt-4">
			<dl class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{@render stat(
					t('admin-users.detail.stats.lastLogin'),
					rel(s.lastLoginAt),
					dt(s.lastLoginAt)
				)}
				{@render stat(t('admin-users.detail.stats.lastSeen'), rel(s.lastSeenAt), dt(s.lastSeenAt))}
				{@render stat(t('admin-users.detail.stats.logins30'), formatNumber(s.logins30))}
				{@render stat(t('admin-users.detail.stats.actions30'), formatNumber(s.actions30))}
				{@render stat(t('admin-users.detail.stats.sessions'), formatNumber(s.sessions))}
				{@render stat(
					t('admin-users.detail.stats.apiKeys'),
					formatNumber(s.apiKeys.active),
					s.apiKeys.lastUsedAt
						? t('admin-users.detail.stats.lastUsed', { when: rel(s.apiKeys.lastUsedAt) })
						: undefined
				)}
				{@render stat(t('admin-users.detail.stats.apiCalls30'), formatNumber(s.apiCalls30))}
				{@render stat(
					t('admin-users.detail.stats.files'),
					formatNumber(s.files.count),
					formatBytes(s.files.bytes)
				)}
				{@render stat(
					t('admin-users.detail.stats.ai30'),
					formatNumber(s.ai30.tokens),
					t('admin-users.detail.stats.aiCost', { cost: formatNumber(s.ai30.costUsd, 2) })
				)}
				{@render stat(
					t('admin-users.detail.stats.passwordChanged'),
					rel(s.passwordChangedAt),
					dt(s.passwordChangedAt)
				)}
				{@render stat(
					t('admin-users.detail.stats.access'),
					t('admin-users.detail.stats.accessValue', { roles: s.roles, permissions: s.permissions })
				)}
				{@render stat(t('admin-users.detail.stats.created'), formatDate(new Date(s.createdAt)))}
			</dl>

			<Card.Root>
				<Card.Header>
					<Card.Title level={2} class="text-section"
						>{t('admin-users.detail.activityTitle')}</Card.Title
					>
					<Card.Description>{t('admin-users.detail.activityDescription')}</Card.Description>
				</Card.Header>
				<Card.Content>
					<ActivityChart days={s.activity} />
				</Card.Content>
			</Card.Root>

			{#if data.impersonations.length}
				<Card.Root>
					<Card.Header>
						<Card.Title level={2} class="text-section"
							>{t('admin-users.detail.impersonationsTitle')}</Card.Title
						>
					</Card.Header>
					<Card.Content>
						<ul class="divide-y text-sm">
							{#each data.impersonations as i (i.id)}
								<li class="flex flex-wrap items-baseline justify-between gap-2 py-2">
									<span>
										<span class="font-medium">{i.adminName ?? '–'}</span>
										<span class="text-muted-foreground">· {i.reason}</span>
									</span>
									<span class="text-xs text-muted-foreground tabular-nums">
										{formatDateTime(new Date(i.startedAt))}
										{#if !i.endedAt}<Badge variant="warning"
												>{t('admin-users.detail.impersonationRunning')}</Badge
											>{/if}
									</span>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/if}
		</Tabs.Content>

		<!-- Aktivität -->
		{#if data.activity}
			<Tabs.Content value="activity" class="pt-4">
				<DataTable
					mobile="cards"
					caption={t('admin-users.detail.tabs.activity')}
					empty={data.activity.rows.length === 0}
					emptyTitle={t('admin-users.detail.activityEmpty')}
				>
					{#snippet head()}
						<Table.Row>
							<Table.Head>{t('admin-users.detail.audit.when')}</Table.Head>
							<Table.Head>{t('admin-users.detail.audit.action')}</Table.Head>
							<Table.Head>{t('admin-users.detail.audit.role')}</Table.Head>
							<Table.Head>{t('admin-users.detail.audit.ip')}</Table.Head>
						</Table.Row>
					{/snippet}
					{#each data.activity.rows as r (r.id)}
						<Table.Row>
							<Table.Cell class="whitespace-nowrap tabular-nums"
								>{formatDateTime(new Date(r.createdAt))}</Table.Cell
							>
							<Table.Cell><code class="text-xs">{r.action}</code></Table.Cell>
							<Table.Cell>
								{#if r.impersonatorId === u.id}
									<Badge variant="warning">{t('admin-users.detail.audit.asImpersonator')}</Badge>
								{:else if r.actorId === u.id && r.impersonatorId}
									<Badge variant="warning">{t('admin-users.detail.audit.byImpersonation')}</Badge>
								{:else if r.actorId === u.id}
									{t('admin-users.detail.audit.byUser')}
								{:else}
									<span class="text-muted-foreground"
										>{t('admin-users.detail.audit.byOther', { name: r.actorName ?? '–' })}</span
									>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-xs text-muted-foreground">{r.ip ?? '–'}</Table.Cell>
						</Table.Row>
					{/each}
					{#snippet footer()}
						<Pagination
							total={data.activity!.total}
							limit={data.activity!.pageSize}
							pageParam="apage"
						/>
					{/snippet}
				</DataTable>
			</Tabs.Content>
		{/if}

		<!-- Sitzungen -->
		<Tabs.Content value="sessions" class="pt-4">
			<Card.Root>
				<Card.Header>
					<Card.Title level={2} class="text-section"
						>{t('admin-users.detail.sessionsTitle')}</Card.Title
					>
					<Card.Description>{t('admin-users.detail.sessionsDescription')}</Card.Description>
					{#if data.can.edit && data.sessions.length}
						<Card.Action>
							<form
								method="POST"
								action="?/revokeSession"
								bind:this={revokeAllForm}
								use:enhance={submit()}
							>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={busy}
									onclick={() =>
										ask(
											revokeAllForm,
											t('admin-users.detail.revokeAllTitle'),
											t('admin-users.detail.revokeAllDescription', { name: u.name }),
											t('admin-users.detail.revokeAll'),
											true
										)}>{t('admin-users.detail.revokeAll')}</Button
								>
							</form>
						</Card.Action>
					{/if}
				</Card.Header>
				<Card.Content>
					{#if data.sessions.length === 0}
						<p class="text-sm text-muted-foreground">{t('admin-users.detail.noSessions')}</p>
					{:else}
						<ul class="divide-y">
							{#each data.sessions as sess (sess.id)}
								{@const Icon = /Mobile|Android|iPhone/i.test(sess.userAgent ?? '')
									? SmartphoneIcon
									: MonitorIcon}
								<li class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
									<div class="flex min-w-0 items-center gap-3">
										<Icon class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
										<div class="min-w-0">
											<p class="truncate font-medium" title={sess.userAgent ?? undefined}>
												{describeUserAgent(sess.userAgent)}
											</p>
											<p class="text-xs text-muted-foreground">
												{t('admin-users.detail.sessionInfo', {
													ip: sess.ipAddress ?? '–',
													created: formatDateTime(new Date(sess.createdAt)),
													seen: formatRelative(new Date(sess.updatedAt))
												})}
											</p>
										</div>
									</div>
									{#if data.can.edit}
										<form method="POST" action="?/revokeSession" use:enhance={submit()}>
											<input type="hidden" name="sessionId" value={sess.id} />
											<Button type="submit" variant="outline" size="sm" disabled={busy}
												>{t('admin-users.detail.revoke')}</Button
											>
										</form>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<!-- Sicherheit -->
		<Tabs.Content value="security" class="space-y-4 pt-4">
			{#if !data.can.edit}
				<p class="text-sm text-muted-foreground">{t('admin-users.detail.readOnly')}</p>
			{:else}
				<Card.Root>
					<Card.Header>
						<Card.Title level={2} class="text-section"
							>{t('admin-users.detail.passwordTitle')}</Card.Title
						>
						<Card.Description>{t('admin-users.detail.passwordDescription')}</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-4">
						<div class="flex flex-wrap gap-2">
							<form
								method="POST"
								action="?/sendReset"
								bind:this={sendResetForm}
								use:enhance={submit()}
							>
								<Button
									type="button"
									variant="outline"
									disabled={busy || !u.active}
									onclick={() =>
										ask(
											sendResetForm,
											t('admin-users.detail.sendResetTitle'),
											t('admin-users.detail.sendResetDescription', { email: u.email }),
											t('admin-users.detail.sendReset')
										)}>{t('admin-users.detail.sendReset')}</Button
								>
							</form>
							<form
								method="POST"
								action="?/resetLink"
								use:enhance={submit((d) => (resetLink = (d.link as string) ?? null))}
							>
								<Button type="submit" variant="outline" disabled={busy || !u.active}
									>{t('admin-users.detail.createLink')}</Button
								>
							</form>
							<Button
								variant="outline"
								disabled={busy}
								onclick={() => (
									(generated = null),
									(passwordMode = 'generate'),
									(passwordOpen = true)
								)}><KeyRoundIcon />{t('admin-users.detail.setPassword')}</Button
							>
							{#if data.can.invite && !s.lastLoginAt}
								<form method="POST" action="?/invite" bind:this={inviteForm} use:enhance={submit()}>
									<Button type="submit" variant="outline" disabled={busy || !u.active}
										>{t('admin-users.detail.resendInvite')}</Button
									>
								</form>
							{/if}
						</div>
						{#if resetLink}
							<Alert variant="info">
								<AlertTitle>{t('admin-users.detail.linkTitle')}</AlertTitle>
								<AlertDescription class="space-y-2">
									<p>{t('admin-users.detail.linkHint')}</p>
									<div class="flex gap-2">
										<Input
											readonly
											value={resetLink}
											aria-label={t('admin-users.detail.linkTitle')}
											class="font-mono text-xs"
										/>
										<Button
											variant="outline"
											size="icon"
											aria-label={t('admin-users.detail.copy')}
											onclick={() => copy(resetLink!)}><CopyIcon /></Button
										>
									</div>
								</AlertDescription>
							</Alert>
						{/if}
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header>
						<Card.Title level={2} class="text-section"
							>{t('admin-users.detail.accountTitle')}</Card.Title
						>
					</Card.Header>
					<Card.Content class="flex flex-wrap gap-2">
						{#if u.twoFactorEnabled}
							<form
								method="POST"
								action="?/resetTwoFactor"
								bind:this={resetTwoFactorForm}
								use:enhance={submit()}
							>
								<Button
									type="button"
									variant="outline"
									disabled={busy}
									onclick={() =>
										ask(
											resetTwoFactorForm,
											t('admin-users.detail.resetTwoFactorTitle'),
											t('admin-users.detail.resetTwoFactorDescription', { name: u.name }),
											t('admin-users.detail.resetTwoFactor'),
											true
										)}>{t('admin-users.detail.resetTwoFactor')}</Button
								>
							</form>
						{/if}
						{#if !u.emailVerified}
							<form method="POST" action="?/verifyEmail" use:enhance={submit()}>
								<Button type="submit" variant="outline" disabled={busy}
									>{t('admin-users.verifyEmail')}</Button
								>
							</form>
						{/if}
						<form
							method="POST"
							action="?/setActive"
							bind:this={setActiveForm}
							use:enhance={submit()}
						>
							<input type="hidden" name="active" value={String(!u.active)} />
							{#if u.active}
								<Button
									type="button"
									variant="outline"
									disabled={busy}
									onclick={() =>
										ask(
											setActiveForm,
											t('admin-users.detail.deactivateTitle'),
											t('admin-users.detail.deactivateDescription', { name: u.name }),
											t('admin-users.deactivate'),
											true
										)}>{t('admin-users.deactivate')}</Button
								>
							{:else}
								<Button type="submit" variant="outline" disabled={busy}
									>{t('admin-users.activate')}</Button
								>
							{/if}
						</form>
						{#if data.can.delete}
							<form method="POST" action="?/delete" bind:this={deleteForm} use:enhance={submit()}>
								<input type="hidden" name="id" value={u.id} />
								<Button
									type="button"
									variant="destructive"
									disabled={busy}
									onclick={() =>
										ask(
											deleteForm,
											t('admin-users.deleteTitle'),
											t('admin-users.deleteDescription', { name: u.name, email: u.email }) +
												' ' +
												t('admin-users.deleteDetails'),
											t('admin-users.deleteConfirm'),
											true
										)}>{t('admin-users.delete')}</Button
								>
							</form>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}
		</Tabs.Content>

		<!-- Rechte -->
		<Tabs.Content value="permissions" class="pt-4">
			{#if data.permissions.length === 0}
				<p class="text-sm text-muted-foreground">{t('admin-users.detail.noPermissions')}</p>
			{:else}
				<div class="grid gap-4 lg:grid-cols-2">
					{#each permissionGroups as [moduleId, perms] (moduleId)}
						<Card.Root>
							<Card.Header>
								<Card.Title level={2} class="text-section">
									{moduleId === 'core' ? t('admin-users.detail.coreModule') : moduleId}
									<span class="text-sm font-normal text-muted-foreground tabular-nums"
										>{perms.length}</span
									>
								</Card.Title>
							</Card.Header>
							<Card.Content>
								<ul class="space-y-2 text-sm">
									{#each perms as p (p.key)}
										<li class="flex flex-wrap items-baseline justify-between gap-2">
											<code class="text-xs">{p.key}</code>
											<span class="flex flex-wrap gap-1">
												{#each p.sources as src, i (i)}
													{#if src.kind === 'direct'}
														<Badge variant="outline">{t('admin-users.detail.sourceDirect')}</Badge>
													{:else if src.kind === 'grant'}
														<Badge variant="info"
															>{t('admin-users.detail.sourceGrant', {
																role: src.roleName,
																module: src.moduleId
															})}</Badge
														>
													{:else}
														<Badge variant="secondary">{src.roleName}</Badge>
													{/if}
												{/each}
											</span>
										</li>
									{/each}
								</ul>
							</Card.Content>
						</Card.Root>
					{/each}
				</div>
			{/if}
		</Tabs.Content>
	</Tabs.Root>
</div>

{#snippet stat(label: string, value: string, sub?: string)}
	<div class="rounded-lg border bg-card p-4">
		<dt class="text-xs text-muted-foreground">{label}</dt>
		<dd class="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
		{#if sub}<dd class="text-xs text-muted-foreground">{sub}</dd>{/if}
	</div>
{/snippet}

<ConfirmDialog
	bind:open={
		() => !!confirm,
		(v) => {
			if (!v) confirm = null;
		}
	}
	title={confirm?.title ?? ''}
	description={confirm?.description}
	confirmLabel={confirm?.label ?? ''}
	destructive={confirm?.destructive}
	onconfirm={() => confirm?.form?.requestSubmit()}
/>

<!-- Passwort setzen -->
<Dialog.Root bind:open={passwordOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{t('admin-users.detail.setPassword')}</Dialog.Title>
			<Dialog.Description
				>{t('admin-users.detail.setPasswordDescription', { name: u.name })}</Dialog.Description
			>
		</Dialog.Header>
		{#if generated}
			<Alert variant="success">
				<AlertTitle>{t('admin-users.detail.generatedTitle')}</AlertTitle>
				<AlertDescription class="space-y-2">
					<p>{t('admin-users.detail.generatedHint')}</p>
					<div class="flex gap-2">
						<Input
							readonly
							value={generated}
							class="font-mono"
							aria-label={t('admin-users.detail.generatedTitle')}
						/>
						<Button
							variant="outline"
							size="icon"
							aria-label={t('admin-users.detail.copy')}
							onclick={() => copy(generated!)}><CopyIcon /></Button
						>
					</div>
				</AlertDescription>
			</Alert>
			<Dialog.Footer>
				<Button onclick={() => ((passwordOpen = false), (generated = null))}
					>{t('admin-users.close')}</Button
				>
			</Dialog.Footer>
		{:else}
			<form
				method="POST"
				action="?/setPassword"
				class="space-y-4"
				use:enhance={submit((d) => {
					generated = (d.generatedPassword as string | null) ?? null;
					if (!generated) passwordOpen = false;
				})}
			>
				<SelectField
					label={t('admin-users.detail.passwordMode')}
					name="mode"
					options={[
						{ value: 'generate', label: t('admin-users.detail.modeGenerate') },
						{ value: 'manual', label: t('admin-users.detail.modeManual') }
					]}
					bind:value={
						() => passwordMode, (v) => (passwordMode = v === 'manual' ? 'manual' : 'generate')
					}
				/>
				{#if passwordMode === 'manual'}
					<FormField
						label={t('admin-users.password')}
						id="d-pw"
						required
						hint={t('admin-users.detail.passwordManualHint')}
					>
						<Input
							id="d-pw"
							name="password"
							type="text"
							required
							minlength={12}
							maxlength={128}
							autocomplete="off"
						/>
					</FormField>
				{/if}
				<label class="flex items-start gap-2 text-sm">
					<Checkbox name="mustChange" checked class="mt-0.5" />
					<span>
						<span class="font-medium">{t('admin-users.detail.mustChangeLabel')}</span>
						<span class="block text-xs text-muted-foreground"
							>{t('admin-users.detail.mustChangeHint')}</span
						>
					</span>
				</label>
				<p class="text-xs text-muted-foreground">{t('admin-users.detail.sessionsEndHint')}</p>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (passwordOpen = false)}
						>{t('admin-users.cancel')}</Button
					>
					<Button type="submit" disabled={busy}>{t('admin-users.detail.setPasswordSubmit')}</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Als Person handeln -->
<Dialog.Root bind:open={impersonateOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{t('admin-users.detail.impersonateTitle', { name: u.name })}</Dialog.Title>
			<Dialog.Description>{t('admin-users.detail.impersonateDescription')}</Dialog.Description>
		</Dialog.Header>
		<Alert variant="warning">
			<AlertDescription>{t('admin-users.detail.impersonateWarning')}</AlertDescription>
		</Alert>
		<form method="POST" action="?/impersonate" class="space-y-4" use:enhance={impersonateSubmit}>
			<FormField
				label={t('admin-users.detail.reason')}
				id="imp-reason"
				required
				hint={t('admin-users.detail.reasonHint')}
				error={impersonateError?.field === 'reason' ? impersonateError.message : undefined}
			>
				<Textarea id="imp-reason" name="reason" required minlength={3} maxlength={500} rows={2} />
			</FormField>
			<SelectField
				label={t('admin-users.detail.duration')}
				name="minutes"
				options={data.impersonationMinutes.map((m) => ({
					value: String(m),
					label: t('admin-users.detail.minutes', { count: m })
				}))}
				bind:value={impersonateMinutes}
			/>
			<FormField
				label={t('admin-users.detail.yourPassword')}
				id="imp-pw"
				required
				error={impersonateError?.field === 'password' ? impersonateError.message : undefined}
			>
				<Input
					id="imp-pw"
					name="password"
					type="password"
					required
					autocomplete="current-password"
				/>
			</FormField>
			{#if data.ownTwoFactor}
				<FormField
					label={t('admin-users.detail.totp')}
					id="imp-totp"
					required
					error={impersonateError?.field === 'totp' ? impersonateError.message : undefined}
				>
					<Input
						id="imp-totp"
						name="totp"
						inputmode="numeric"
						autocomplete="one-time-code"
						required
					/>
				</FormField>
			{/if}
			{#if impersonateError && !impersonateError.field}
				<p class="text-sm text-destructive" role="alert">{impersonateError.message}</p>
			{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (impersonateOpen = false)}
					>{t('admin-users.cancel')}</Button
				>
				<Button type="submit" disabled={busy}>{t('admin-users.detail.impersonateSubmit')}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
