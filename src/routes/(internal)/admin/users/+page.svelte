<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import type { SubmitFunction } from '@sveltejs/kit';
	import MailCheckIcon from '@lucide/svelte/icons/mail-check';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UserCheckIcon from '@lucide/svelte/icons/user-check';
	import UserXIcon from '@lucide/svelte/icons/user-x';
	import {
		busySave,
		ConfirmDialog,
		DataTable,
		EntityAvatar,
		ErrorState,
		FileField,
		FormField,
		LoadingState,
		PageHeader,
		Pagination,
		SearchInput,
		PageTitle
	} from '$lib/components/layout';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';
	import PermissionPicker from '../_shared/PermissionPicker.svelte';
	import { t } from '$lib/i18n';
	import { formatDate } from '$lib/i18n/intl';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type UserRow = PageData['users'][number];

	/** Hinweis für Konten mit Rechten, die man selbst nicht besitzt (der Server lehnt Änderungen ab) */
	const LOCKED_HINT = t('admin-users.lockedHint');

	let createOpen = $state(false);
	let editOpen = $state(false);
	let deleteOpen = $state(false);
	let busy = $state(false);
	let editUserId = $state<string | null>(null);
	/** Aus `data` abgeleitet, damit ein neues Profilbild nach dem Speichern sofort erscheint */
	const editUser = $derived(data.users.find((u) => u.id === editUserId) ?? null);
	let deleteUser = $state<UserRow | null>(null);
	let editRoleIds = $state<string[]>([]);
	let editPermissionKeys = $state<string[]>([]);
	let editName = $state('');
	let editEmail = $state('');
	/** Reiter: `account`, `access` oder der Schlüssel eines Modul-Abschnitts */
	let editTab = $state('account');
	let createRoleIds = $state<string[]>([]);
	let createPermissionKeys = $state<string[]>([]);
	let createTab = $state('account');
	let formError = $state('');

	/** Reiter „Rollen & Rechte“ nur, wenn es etwas zu vergeben gibt */
	const showAccess = $derived(
		data.can.assign && (data.roles.length > 0 || data.permissions.length > 0)
	);

	function fmt(d: Date) {
		return formatDate(new Date(d));
	}

	const sameSet = (a: string[], b: string[]) =>
		a.length === b.length && a.every((x) => b.includes(x));

	// Ungespeicherte Änderungen je Reiter (Punkt am Reiter, Hinweis in der Fußzeile)
	const accountDirty = $derived(
		!!editUser && (editName !== editUser.name || editEmail !== editUser.email)
	);
	const accessDirty = $derived(
		!!editUser &&
			(!sameSet(
				editRoleIds,
				editUser.roles.map((r) => r.id)
			) ||
				!sameSet(editPermissionKeys, editUser.permissions))
	);
	/** Modul-Abschnitte speichern selbst – dort gilt der Speichern-Knopf des Dialogs nicht */
	const onModuleTab = $derived(editTab !== 'account' && editTab !== 'access');

	function openEdit(u: UserRow) {
		editUserId = u.id;
		editName = u.name;
		editEmail = u.email;
		editRoleIds = u.roles.map((r) => r.id);
		editPermissionKeys = [...u.permissions];
		editTab = 'account';
		formError = '';
		avatarFile = null;
		editOpen = true;
	}

	function openCreate() {
		formError = '';
		createRoleIds = [];
		createPermissionKeys = [];
		createTab = 'account';
		createOpen = true;
	}

	// --- Profilbild (im Bearbeiten-Dialog)
	let avatarFile = $state<File | null>(null);
	let avatarRemoveOpen = $state(false);
	let avatarRemoveForm = $state<HTMLFormElement | null>(null);
	let preview = $state<string | null>(null);
	$effect(() => {
		if (!avatarFile) {
			preview = null;
			return;
		}
		const url = URL.createObjectURL(avatarFile);
		preview = url;
		return () => URL.revokeObjectURL(url);
	});

	// --- Abschnitte aus Modulen (`userAdminSections`), Komponente je Schlüssel nur einmal laden
	const userSections = $derived(data.userSections);
	type UserSection = (typeof userSections)[number];
	const loadedSections = new Map<string, ReturnType<UserSection['component']>>();
	function sectionComponent(s: UserSection) {
		let p = loadedSections.get(s.key);
		if (!p) {
			p = s.component();
			loadedSections.set(s.key, p);
		}
		return p;
	}

	function openDelete(u: UserRow) {
		deleteUser = u;
		formError = '';
		deleteOpen = true;
	}

	const toggled = (ids: string[], id: string, checked: boolean) =>
		checked ? [...ids.filter((r) => r !== id), id] : ids.filter((r) => r !== id);

	/** Gemeinsame Enhance-Logik: Ladezustand, Toast, Dialog schließen. */
	const submit =
		(close?: () => void): SubmitFunction =>
		() => {
			busy = true;
			formError = '';
			return async ({ result, update }) => {
				busy = false;
				if (result.type === 'success') {
					toast.success((result.data?.message as string) ?? t('admin-users.saved'));
					close?.();
					await invalidateAll();
				} else if (result.type === 'failure') {
					formError = (result.data?.message as string) ?? t('admin-users.actionFailed');
					toast.error(formError);
				} else {
					await update();
				}
			};
		};
</script>

<PageTitle title={t('admin-users.title')} />

<div class="space-y-6">
	<PageHeader title={t('admin-users.title')} description={t('admin-users.description')}>
		{#snippet actions()}
			{#if data.can.create}
				<Button onclick={openCreate}>{t('admin-users.create')}</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<DataTable
		mobile="cards"
		caption={t('admin-users.title')}
		empty={data.users.length === 0}
		emptyTitle={t('admin-users.empty')}
	>
		{#snippet toolbar()}
			<SearchInput
				param="q"
				resetParams={['page']}
				placeholder={t('admin-users.searchPlaceholder')}
				label={t('admin-users.searchLabel')}
			/>
		{/snippet}
		{#snippet head()}
			<Table.Row>
				<Table.Head>{t('admin-users.col.name')}</Table.Head>
				<Table.Head>{t('admin-users.col.email')}</Table.Head>
				<Table.Head>{t('admin-users.col.roles')}</Table.Head>
				<Table.Head>{t('admin-users.col.status')}</Table.Head>
				<Table.Head>{t('admin-users.col.twoFactor')}</Table.Head>
				<Table.Head>{t('admin-users.col.created')}</Table.Head>
				<Table.Head class="text-right">{t('admin-users.col.actions')}</Table.Head>
			</Table.Row>
		{/snippet}
		{#each data.users as u (u.id)}
			{@const locked = !u.manageable}
			<Table.Row>
				<Table.Cell class="font-medium">
					<span class="flex items-center gap-2">
						<EntityAvatar name={u.name} src={u.image} size={28} />
						{u.name}
					</span>
				</Table.Cell>
				<Table.Cell>{u.email}</Table.Cell>
				<Table.Cell>
					<div class="flex flex-wrap gap-1">
						{#each u.roles as r (r.id)}<Badge variant="secondary">{r.name}</Badge>{/each}
						{#if u.permissions.length}
							<Badge variant="outline" title={u.permissions.join(', ')}
								>{t('admin-users.extraPermissions', { count: u.permissions.length })}</Badge
							>
						{/if}
						{#if !u.roles.length && !u.permissions.length}<span class="text-muted-foreground"
								>–</span
							>{/if}
					</div>
				</Table.Cell>
				<Table.Cell>
					<div class="flex flex-wrap gap-1">
						{#if u.active}<Badge>{t('admin-users.active')}</Badge>{:else}<Badge
								variant="destructive">{t('admin-users.inactive')}</Badge
							>{/if}
						{#if !u.emailVerified}
							<Badge variant="warning" title={t('admin-users.unverifiedHint')}
								>{t('admin-users.unverified')}</Badge
							>
						{/if}
					</div>
				</Table.Cell>
				<Table.Cell>{u.twoFactorEnabled ? t('admin-users.yes') : t('admin-users.no')}</Table.Cell>
				<Table.Cell>{fmt(u.createdAt)}</Table.Cell>
				<Table.Cell class="text-right">
					<div class="flex justify-end gap-1">
						{#if data.can.edit}
							<Button
								size="icon-sm"
								variant="outline"
								disabled={locked}
								aria-label={t('admin-users.edit')}
								title={locked ? LOCKED_HINT : t('admin-users.edit')}
								onclick={() => openEdit(u)}><PencilIcon /></Button
							>
							{#if !u.emailVerified}
								<form method="POST" action="?/verifyEmail" use:enhance={submit()}>
									<input type="hidden" name="id" value={u.id} />
									<Button
										size="icon-sm"
										variant="outline"
										type="submit"
										disabled={busy || locked}
										aria-label={t('admin-users.verifyEmail')}
										title={locked ? LOCKED_HINT : t('admin-users.verifyEmailHint')}
									>
										<MailCheckIcon />
									</Button>
								</form>
							{/if}
							{#if u.id !== data.selfId}
								<form method="POST" action="?/setActive" use:enhance={submit()}>
									<input type="hidden" name="id" value={u.id} />
									<input type="hidden" name="active" value={String(!u.active)} />
									<Button
										size="icon-sm"
										variant="outline"
										type="submit"
										disabled={busy || locked}
										aria-label={u.active ? t('admin-users.deactivate') : t('admin-users.activate')}
										title={locked
											? LOCKED_HINT
											: u.active
												? t('admin-users.deactivate')
												: t('admin-users.activate')}
									>
										{#if u.active}<UserXIcon />{:else}<UserCheckIcon />{/if}
									</Button>
								</form>
							{/if}
						{/if}
						{#if data.can.delete && u.id !== data.selfId}
							<Button
								size="icon-sm"
								variant="destructive"
								disabled={locked}
								aria-label={t('admin-users.delete')}
								title={locked ? LOCKED_HINT : t('admin-users.delete')}
								onclick={() => openDelete(u)}><Trash2Icon /></Button
							>
						{/if}
					</div>
					{#if locked && (data.can.edit || data.can.delete)}
						<p class="mt-1 text-xs text-muted-foreground">{t('admin-users.lockedShort')}</p>
					{/if}
				</Table.Cell>
			</Table.Row>
		{/each}
		{#snippet footer()}
			<Pagination total={data.total} limit={data.pageSize} pageParam="page" />
		{/snippet}
	</DataTable>
</div>

<!-- Rollen-Auswahl (Anlegen und Bearbeiten); nicht vergebbare, bereits gesetzte Rollen bleiben erhalten -->
{#snippet rolePicker(selected: string[], onchange: (ids: string[]) => void, prefix: string)}
	<fieldset class="space-y-2">
		<legend class="text-sm font-medium">{t('admin-users.rolesLegend')}</legend>
		<div class="grid gap-2 sm:grid-cols-2">
			{#each data.roles as r (r.id)}
				{@const checked = selected.includes(r.id)}
				<label
					class="flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm has-[[data-state=checked]]:border-ring has-[[data-state=checked]]:bg-muted/60"
					class:opacity-50={!r.assignable && !checked}
					title={r.assignable ? undefined : t('admin-users.roleNotAssignable')}
				>
					<Checkbox
						id="{prefix}-role-{r.id}"
						{checked}
						disabled={!r.assignable}
						onCheckedChange={(v) => onchange(toggled(selected, r.id, v))}
					/>
					<span class="truncate">{r.name}</span>
				</label>
			{/each}
		</div>
	</fieldset>
{/snippet}

{#snippet permissionSection(prefix: string, titleId: string)}
	<section class="space-y-2" aria-labelledby={titleId}>
		<h3 id={titleId} class="text-sm font-medium">{t('admin-users.permissionsTitle')}</h3>
		<p class="text-xs text-muted-foreground">
			{t('admin-users.permissionsHint')}
		</p>
		{#if prefix === 'c'}
			<PermissionPicker
				permissions={data.permissions}
				bind:selected={createPermissionKeys}
				idPrefix="c-perm"
			/>
		{:else}
			<PermissionPicker
				permissions={data.permissions}
				bind:selected={editPermissionKeys}
				idPrefix="e-perm"
			/>
		{/if}
	</section>
{/snippet}

{#snippet dirtyDot(show: boolean)}
	{#if show}
		<span class="size-1.5 rounded-full bg-primary" aria-hidden="true"></span>
		<span class="sr-only">{t('admin-users.unsaved')}</span>
	{/if}
{/snippet}

<!-- Benutzer anlegen -->
<Dialog.Root bind:open={createOpen}>
	<Dialog.Content class="flex flex-col sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{t('admin-users.create')}</Dialog.Title>
			<Dialog.Description>{t('admin-users.createDescription')}</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/create"
			class="flex min-h-0 flex-1 flex-col gap-4"
			use:enhance={submit(() => (createOpen = false))}
		>
			<Tabs.Root bind:value={createTab} class="flex min-h-0 flex-1 flex-col gap-3">
				{#if showAccess}
					<Tabs.List variant="line" class="w-full justify-start">
						<Tabs.Trigger value="account" class="flex-none"
							>{t('admin-users.tabAccount')}</Tabs.Trigger
						>
						<Tabs.Trigger value="access" class="flex-none">
							{t('admin-users.tabAccess')}
							{#if createRoleIds.length + createPermissionKeys.length}
								<span class="text-muted-foreground tabular-nums"
									>{createRoleIds.length + createPermissionKeys.length}</span
								>
							{/if}
						</Tabs.Trigger>
					</Tabs.List>
				{/if}
				<div class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1 sm:min-h-[20rem]">
					<Tabs.Content value="account" class="space-y-4">
						<div class="grid gap-4 sm:grid-cols-2">
							<FormField label={t('admin-users.name')} id="c-name" required>
								<Input id="c-name" name="name" required maxlength={100} autocomplete="off" />
							</FormField>
							<FormField label={t('admin-users.email')} id="c-email" required>
								<Input id="c-email" name="email" type="email" required autocomplete="off" />
							</FormField>
						</div>
						<FormField
							label={t('admin-users.password')}
							id="c-pw"
							required
							hint={t('admin-users.passwordHint')}
						>
							<Input
								id="c-pw"
								name="password"
								type="password"
								required
								minlength={12}
								autocomplete="new-password"
							/>
						</FormField>
					</Tabs.Content>
					{#if showAccess}
						<Tabs.Content value="access" class="space-y-6">
							{#if data.roles.length}
								{@render rolePicker(createRoleIds, (ids) => (createRoleIds = ids), 'c')}
							{/if}
							{#if data.permissions.length}
								{@render permissionSection('c', 'c-perms-title')}
							{/if}
						</Tabs.Content>
					{/if}
				</div>
			</Tabs.Root>
			{#each createRoleIds as id (id)}
				<input type="hidden" name="roleIds" value={id} />
			{/each}
			{#each createPermissionKeys as key (key)}
				<input type="hidden" name="permissionKeys" value={key} />
			{/each}
			{#if formError}<p class="text-sm text-destructive" role="alert">{formError}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (createOpen = false)}
					>{t('admin-users.cancel')}</Button
				>
				<Button type="submit" disabled={busy}
					>{busy ? busySave() : t('admin-users.createSubmit')}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Benutzer bearbeiten -->
<Dialog.Root bind:open={editOpen}>
	<Dialog.Content class="flex flex-col sm:max-w-2xl">
		{#if editUser}
			<Dialog.Header>
				<div class="flex min-w-0 items-center gap-3">
					<EntityAvatar name={editUser.name} src={preview ?? editUser.image} size={48} />
					<div class="min-w-0 space-y-1">
						<Dialog.Title class="truncate">
							<span class="sr-only">{t('admin-users.editTitleSr')}</span>{editUser.name}
						</Dialog.Title>
						<Dialog.Description class="truncate">{editUser.email}</Dialog.Description>
						<div class="flex flex-wrap gap-1">
							{#if editUser.active}<Badge variant="success">{t('admin-users.active')}</Badge
								>{:else}<Badge variant="destructive">{t('admin-users.inactive')}</Badge>{/if}
							{#if !editUser.emailVerified}<Badge variant="warning"
									>{t('admin-users.emailUnverified')}</Badge
								>{/if}
							<Badge variant="outline"
								>{editUser.twoFactorEnabled
									? t('admin-users.twoFactorOn')
									: t('admin-users.twoFactorOff')}</Badge
							>
							<Badge variant="outline"
								>{t('admin-users.since', { date: fmt(editUser.createdAt) })}</Badge
							>
						</div>
					</div>
				</div>
			</Dialog.Header>

			<Tabs.Root bind:value={editTab} class="flex min-h-0 flex-1 flex-col gap-3">
				<Tabs.List variant="line" class="w-full justify-start">
					<Tabs.Trigger value="account" class="flex-none">
						{t('admin-users.tabAccount')}
						{@render dirtyDot(accountDirty)}
					</Tabs.Trigger>
					{#if showAccess}
						<Tabs.Trigger value="access" class="flex-none">
							{t('admin-users.tabAccess')}
							{#if editRoleIds.length + editPermissionKeys.length}
								<span class="text-muted-foreground tabular-nums"
									>{editRoleIds.length + editPermissionKeys.length}</span
								>
							{/if}
							{@render dirtyDot(accessDirty)}
						</Tabs.Trigger>
					{/if}
					{#each userSections as s (s.key)}
						<Tabs.Trigger value={s.key} class="flex-none">{s.title}</Tabs.Trigger>
					{/each}
				</Tabs.List>

				<!-- Inaktive Reiter bleiben eingehängt (bits-ui setzt `hidden`): Eingaben und Modul-Daten gehen beim Wechsel nicht verloren -->
				<div class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1 sm:min-h-[24rem]">
					<Tabs.Content value="account" class="space-y-6">
						<div class="grid gap-4 sm:grid-cols-2">
							<FormField label={t('admin-users.name')} id="e-name" required>
								<Input
									id="e-name"
									name="name"
									form="e-user-form"
									required
									maxlength={100}
									bind:value={editName}
								/>
							</FormField>
							<FormField label={t('admin-users.email')} id="e-email" required>
								<Input
									id="e-email"
									name="email"
									type="email"
									form="e-user-form"
									required
									bind:value={editEmail}
								/>
							</FormField>
						</div>

						<section class="space-y-3 border-t pt-4" aria-labelledby="e-avatar-title">
							<div>
								<h3 id="e-avatar-title" class="text-sm font-medium">{t('admin-users.avatar')}</h3>
								<p class="text-xs text-muted-foreground">
									{t('admin-users.avatarHint')}
								</p>
							</div>
							<form
								method="POST"
								action="?/setAvatar"
								enctype="multipart/form-data"
								class="flex flex-col gap-2 sm:flex-row sm:items-center"
								use:enhance={submit(() => (avatarFile = null))}
							>
								<input type="hidden" name="id" value={editUser.id} />
								<div class="min-w-0 flex-1">
									<FileField
										id="e-avatar-file"
										name="avatar"
										bind:file={avatarFile}
										accept="image/png,image/jpeg,image/webp"
										maxBytes={2 * 1024 * 1024}
										crop={{ shape: 'circle', maxEdge: 512, title: t('admin-users.avatarCrop') }}
										disabled={busy}
									/>
								</div>
								<div class="flex flex-wrap gap-2">
									<Button type="submit" size="sm" disabled={!avatarFile || busy}>
										{busy && avatarFile ? t('admin-users.uploading') : t('admin-users.upload')}
									</Button>
									{#if editUser.image && !avatarFile}
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={busy}
											onclick={() => (avatarRemoveOpen = true)}>{t('admin-users.remove')}</Button
										>
									{/if}
								</div>
							</form>
							<form
								method="POST"
								action="?/removeAvatar"
								class="hidden"
								bind:this={avatarRemoveForm}
								use:enhance={submit()}
							>
								<input type="hidden" name="id" value={editUser.id} />
							</form>
						</section>
					</Tabs.Content>

					{#if showAccess}
						<Tabs.Content value="access" class="space-y-6">
							{#if data.roles.length}
								{@render rolePicker(editRoleIds, (ids) => (editRoleIds = ids), 'e')}
							{/if}
							{#if data.permissions.length}
								{@render permissionSection('e', 'e-perms-title')}
							{/if}
						</Tabs.Content>
					{/if}

					{#each userSections as s (s.key)}
						<Tabs.Content value={s.key} class="space-y-3">
							{#await sectionComponent(s)}
								<LoadingState label={s.title} rows={1} rowClass="h-16 w-full" />
							{:then mod}
								{@const Section = mod.default}
								{#key editUser.id}
									<Section userId={editUser.id} userName={editUser.name} />
								{/key}
							{:catch}
								<ErrorState compact message={t('admin-users.sectionError')} />
							{/await}
						</Tabs.Content>
					{/each}
				</div>
			</Tabs.Root>

			<!-- Name/E-Mail hängen per `form`-Attribut an diesem Formular; Rollen/Rechte kommen aus dem Zustand -->
			<form
				id="e-user-form"
				method="POST"
				action="?/update"
				class="hidden"
				use:enhance={submit(() => (editOpen = false))}
			>
				<input type="hidden" name="id" value={editUser.id} />
				{#if data.can.assign && data.roles.length}
					<input type="hidden" name="rolesIncluded" value="1" />
					{#each editRoleIds as id (id)}
						<input type="hidden" name="roleIds" value={id} />
					{/each}
				{/if}
				{#if data.can.assign && data.permissions.length}
					<input type="hidden" name="permissionsIncluded" value="1" />
					{#each editPermissionKeys as key (key)}
						<input type="hidden" name="permissionKeys" value={key} />
					{/each}
				{/if}
			</form>

			{#if formError}<p class="text-sm text-destructive" role="alert">{formError}</p>{/if}
			<Dialog.Footer class="sm:items-center">
				{#if onModuleTab}
					<p class="text-center text-xs text-muted-foreground sm:mr-auto sm:text-left">
						{t('admin-users.sectionSavesItself')}
					</p>
					<Button type="button" variant="outline" onclick={() => (editOpen = false)}
						>{t('admin-users.close')}</Button
					>
				{:else}
					{#if accountDirty || accessDirty}
						<p class="text-center text-xs text-muted-foreground sm:mr-auto sm:text-left">
							{accountDirty && accessDirty
								? t('admin-users.unsavedChangesBoth')
								: t('admin-users.unsavedChanges')}
						</p>
					{/if}
					<Button type="button" variant="outline" onclick={() => (editOpen = false)}
						>{t('admin-users.cancel')}</Button
					>
					<Button type="submit" form="e-user-form" disabled={busy}
						>{busy ? busySave() : t('admin-users.save')}</Button
					>
				{/if}
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<ConfirmDialog
	bind:open={avatarRemoveOpen}
	title={t('admin-users.avatarRemoveTitle')}
	description={editUser
		? t('admin-users.avatarRemoveDescription', { name: editUser.name })
		: undefined}
	confirmLabel={t('admin-users.remove')}
	destructive
	onconfirm={() => avatarRemoveForm?.requestSubmit()}
/>

<!-- Löschen bestätigen -->
<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{t('admin-users.deleteTitle')}</Dialog.Title>
			<Dialog.Description>
				{t('admin-users.deleteDescription', {
					name: deleteUser?.name ?? '',
					email: deleteUser?.email ?? ''
				})}
			</Dialog.Description>
		</Dialog.Header>
		<p class="text-sm text-muted-foreground">
			{t('admin-users.deleteDetails')}
		</p>
		<form method="POST" action="?/delete" use:enhance={submit(() => (deleteOpen = false))}>
			<input type="hidden" name="id" value={deleteUser?.id ?? ''} />
			{#if formError}<p class="mb-3 text-sm text-destructive" role="alert">{formError}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (deleteOpen = false)}
					>{t('admin-users.cancel')}</Button
				>
				<Button type="submit" variant="destructive" disabled={busy}
					>{t('admin-users.deleteConfirm')}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
