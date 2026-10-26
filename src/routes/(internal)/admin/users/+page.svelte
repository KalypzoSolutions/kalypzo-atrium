<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import type { SubmitFunction } from '@sveltejs/kit';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UserCheckIcon from '@lucide/svelte/icons/user-check';
	import UserXIcon from '@lucide/svelte/icons/user-x';
	import {
		BUSY_SAVE,
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
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type UserRow = PageData['users'][number];

	/** Hinweis für Konten mit Rechten, die man selbst nicht besitzt (der Server lehnt Änderungen ab) */
	const LOCKED_HINT =
		'Dieses Konto hat Rechte, die du selbst nicht besitzt. Ändern, Deaktivieren und Löschen kann nur jemand mit mindestens denselben Rechten.';

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
		return new Date(d).toLocaleDateString('de-DE');
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
					toast.success((result.data?.message as string) ?? 'Gespeichert');
					close?.();
					await invalidateAll();
				} else if (result.type === 'failure') {
					formError = (result.data?.message as string) ?? 'Aktion fehlgeschlagen';
					toast.error(formError);
				} else {
					await update();
				}
			};
		};
</script>

<PageTitle title="Benutzer" />

<div class="space-y-6">
	<PageHeader
		title="Benutzer"
		description="Konten verwalten, Rollen zuweisen und Zugriffe sperren."
	>
		{#snippet actions()}
			{#if data.can.create}
				<Button onclick={openCreate}>Benutzer anlegen</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<DataTable
		mobile="cards"
		caption="Benutzer"
		empty={data.users.length === 0}
		emptyTitle="Keine Benutzer gefunden."
	>
		{#snippet toolbar()}
			<SearchInput
				param="q"
				resetParams={['page']}
				placeholder="Name oder E-Mail suchen …"
				label="Benutzer suchen"
			/>
		{/snippet}
		{#snippet head()}
			<Table.Row>
				<Table.Head>Name</Table.Head>
				<Table.Head>E-Mail</Table.Head>
				<Table.Head>Rollen</Table.Head>
				<Table.Head>Status</Table.Head>
				<Table.Head>2FA</Table.Head>
				<Table.Head>Erstellt</Table.Head>
				<Table.Head class="text-right">Aktionen</Table.Head>
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
								>+{u.permissions.length} Einzelrecht{u.permissions.length === 1 ? '' : 'e'}</Badge
							>
						{/if}
						{#if !u.roles.length && !u.permissions.length}<span class="text-muted-foreground"
								>–</span
							>{/if}
					</div>
				</Table.Cell>
				<Table.Cell>
					{#if u.active}<Badge>Aktiv</Badge>{:else}<Badge variant="destructive">Deaktiviert</Badge
						>{/if}
				</Table.Cell>
				<Table.Cell>{u.twoFactorEnabled ? 'Ja' : 'Nein'}</Table.Cell>
				<Table.Cell>{fmt(u.createdAt)}</Table.Cell>
				<Table.Cell class="text-right">
					<div class="flex justify-end gap-1">
						{#if data.can.edit}
							<Button
								size="icon-sm"
								variant="outline"
								disabled={locked}
								aria-label="Bearbeiten"
								title={locked ? LOCKED_HINT : 'Bearbeiten'}
								onclick={() => openEdit(u)}><PencilIcon /></Button
							>
							{#if u.id !== data.selfId}
								<form method="POST" action="?/setActive" use:enhance={submit()}>
									<input type="hidden" name="id" value={u.id} />
									<input type="hidden" name="active" value={String(!u.active)} />
									<Button
										size="icon-sm"
										variant="outline"
										type="submit"
										disabled={busy || locked}
										aria-label={u.active ? 'Deaktivieren' : 'Aktivieren'}
										title={locked ? LOCKED_HINT : u.active ? 'Deaktivieren' : 'Aktivieren'}
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
								aria-label="Löschen"
								title={locked ? LOCKED_HINT : 'Löschen'}
								onclick={() => openDelete(u)}><Trash2Icon /></Button
							>
						{/if}
					</div>
					{#if locked && (data.can.edit || data.can.delete)}
						<p class="mt-1 text-xs text-muted-foreground">Mehr Rechte als du – nicht änderbar</p>
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
		<legend class="text-sm font-medium">Rollen</legend>
		<div class="grid gap-2 sm:grid-cols-2">
			{#each data.roles as r (r.id)}
				{@const checked = selected.includes(r.id)}
				<label
					class="flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm has-[[data-state=checked]]:border-ring has-[[data-state=checked]]:bg-muted/60"
					class:opacity-50={!r.assignable && !checked}
					title={r.assignable ? undefined : 'Diese Rolle kannst du nicht vergeben.'}
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
		<h3 id={titleId} class="text-sm font-medium">Einzelne Berechtigungen</h3>
		<p class="text-xs text-muted-foreground">
			Zusätzlich zu den Rollen. Du kannst nur Rechte vergeben, die du selbst besitzt.
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
		<span class="sr-only">(ungespeichert)</span>
	{/if}
{/snippet}

<!-- Benutzer anlegen -->
<Dialog.Root bind:open={createOpen}>
	<Dialog.Content class="flex flex-col sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Benutzer anlegen</Dialog.Title>
			<Dialog.Description
				>Das Konto wird sofort aktiv. Das Passwort muss mindestens 12 Zeichen lang sein.</Dialog.Description
			>
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
						<Tabs.Trigger value="account" class="flex-none">Konto</Tabs.Trigger>
						<Tabs.Trigger value="access" class="flex-none">
							Rollen & Rechte
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
							<FormField label="Name" id="c-name" required>
								<Input id="c-name" name="name" required maxlength={100} autocomplete="off" />
							</FormField>
							<FormField label="E-Mail" id="c-email" required>
								<Input id="c-email" name="email" type="email" required autocomplete="off" />
							</FormField>
						</div>
						<FormField
							label="Passwort"
							id="c-pw"
							required
							hint="Mindestens 12 Zeichen. Die Person kann es danach im Profil ändern."
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
					>Abbrechen</Button
				>
				<Button type="submit" disabled={busy}>{busy ? BUSY_SAVE : 'Anlegen'}</Button>
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
							<span class="sr-only">Benutzer bearbeiten: </span>{editUser.name}
						</Dialog.Title>
						<Dialog.Description class="truncate">{editUser.email}</Dialog.Description>
						<div class="flex flex-wrap gap-1">
							{#if editUser.active}<Badge variant="success">Aktiv</Badge>{:else}<Badge
									variant="destructive">Deaktiviert</Badge
								>{/if}
							<Badge variant="outline">{editUser.twoFactorEnabled ? '2FA an' : 'Ohne 2FA'}</Badge>
							<Badge variant="outline">seit {fmt(editUser.createdAt)}</Badge>
						</div>
					</div>
				</div>
			</Dialog.Header>

			<Tabs.Root bind:value={editTab} class="flex min-h-0 flex-1 flex-col gap-3">
				<Tabs.List variant="line" class="w-full justify-start">
					<Tabs.Trigger value="account" class="flex-none">
						Konto
						{@render dirtyDot(accountDirty)}
					</Tabs.Trigger>
					{#if showAccess}
						<Tabs.Trigger value="access" class="flex-none">
							Rollen & Rechte
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
							<FormField label="Name" id="e-name" required>
								<Input
									id="e-name"
									name="name"
									form="e-user-form"
									required
									maxlength={100}
									bind:value={editName}
								/>
							</FormField>
							<FormField label="E-Mail" id="e-email" required>
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
								<h3 id="e-avatar-title" class="text-sm font-medium">Profilbild</h3>
								<p class="text-xs text-muted-foreground">
									PNG, JPEG oder WebP. Nach der Auswahl wählst du den Ausschnitt; wird sofort
									gespeichert.
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
										crop={{ shape: 'circle', maxEdge: 512, title: 'Profilbild zuschneiden' }}
										disabled={busy}
									/>
								</div>
								<div class="flex flex-wrap gap-2">
									<Button type="submit" size="sm" disabled={!avatarFile || busy}>
										{busy && avatarFile ? 'Lädt hoch …' : 'Hochladen'}
									</Button>
									{#if editUser.image && !avatarFile}
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={busy}
											onclick={() => (avatarRemoveOpen = true)}>Entfernen</Button
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
								<ErrorState compact message="Dieser Bereich konnte nicht geladen werden." />
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
						Dieser Bereich speichert selbst.
					</p>
					<Button type="button" variant="outline" onclick={() => (editOpen = false)}
						>Schließen</Button
					>
				{:else}
					{#if accountDirty || accessDirty}
						<p class="text-center text-xs text-muted-foreground sm:mr-auto sm:text-left">
							Ungespeicherte Änderungen{accountDirty && accessDirty ? ' in Konto und Rollen' : ''}
						</p>
					{/if}
					<Button type="button" variant="outline" onclick={() => (editOpen = false)}
						>Abbrechen</Button
					>
					<Button type="submit" form="e-user-form" disabled={busy}
						>{busy ? BUSY_SAVE : 'Speichern'}</Button
					>
				{/if}
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<ConfirmDialog
	bind:open={avatarRemoveOpen}
	title="Profilbild entfernen?"
	description={editUser ? `${editUser.name} wird danach mit Initialen angezeigt.` : undefined}
	confirmLabel="Entfernen"
	destructive
	onconfirm={() => avatarRemoveForm?.requestSubmit()}
/>

<!-- Löschen bestätigen -->
<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Benutzer löschen?</Dialog.Title>
			<Dialog.Description>
				„{deleteUser?.name}“ ({deleteUser?.email}) wird unwiderruflich gelöscht. Alternativ kannst
				du das Konto deaktivieren.
			</Dialog.Description>
		</Dialog.Header>
		<p class="text-sm text-muted-foreground">
			Mit dem Konto werden auch die eigenen Dateien (samt öffentlicher Links), das Profilbild, Ämter
			mit persönlicher Beschreibung und die Verknüpfungen zu Mitgliedern entfernt. Termine, Galerien
			und Aktionen dieser Person gehen an dich über.
		</p>
		<form method="POST" action="?/delete" use:enhance={submit(() => (deleteOpen = false))}>
			<input type="hidden" name="id" value={deleteUser?.id ?? ''} />
			{#if formError}<p class="mb-3 text-sm text-destructive" role="alert">{formError}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (deleteOpen = false)}
					>Abbrechen</Button
				>
				<Button type="submit" variant="destructive" disabled={busy}>Endgültig löschen</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
