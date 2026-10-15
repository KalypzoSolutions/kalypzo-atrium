<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { DataTable, Pagination, SearchInput } from '$lib/components/layout';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type UserRow = PageData['users'][number];

	let createOpen = $state(false);
	let editOpen = $state(false);
	let deleteOpen = $state(false);
	let busy = $state(false);
	let editUser = $state<UserRow | null>(null);
	let deleteUser = $state<UserRow | null>(null);
	let editRoleIds = $state<string[]>([]);
	let formError = $state('');

	function fmt(d: Date) {
		return new Date(d).toLocaleDateString('de-DE');
	}

	function openEdit(u: UserRow) {
		editUser = u;
		editRoleIds = u.roles.map((r) => r.id);
		formError = '';
		editOpen = true;
	}

	function openDelete(u: UserRow) {
		deleteUser = u;
		formError = '';
		deleteOpen = true;
	}

	function toggleRole(id: string, checked: boolean) {
		editRoleIds = checked ? [...editRoleIds, id] : editRoleIds.filter((r) => r !== id);
	}

	/** Gemeinsame Enhance-Logik: Ladezustand, Toast, Dialog schliessen. */
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

<svelte:head><title>Benutzer</title></svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold">Benutzer</h1>
			<p class="text-sm text-muted-foreground">
				Konten verwalten, Rollen zuweisen und Zugriffe sperren.
			</p>
		</div>
		{#if data.can.create}
			<Button onclick={() => ((formError = ''), (createOpen = true))}>Benutzer anlegen</Button>
		{/if}
	</div>

	<DataTable
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
			<Table.Row>
				<Table.Cell class="font-medium">{u.name}</Table.Cell>
				<Table.Cell>{u.email}</Table.Cell>
				<Table.Cell>
					<div class="flex flex-wrap gap-1">
						{#each u.roles as r (r.id)}<Badge variant="secondary">{r.name}</Badge>{/each}
						{#if !u.roles.length}<span class="text-muted-foreground">–</span>{/if}
					</div>
				</Table.Cell>
				<Table.Cell>
					{#if u.active}<Badge>Aktiv</Badge>{:else}<Badge variant="destructive">Deaktiviert</Badge
						>{/if}
				</Table.Cell>
				<Table.Cell>{u.twoFactorEnabled ? 'Ja' : 'Nein'}</Table.Cell>
				<Table.Cell>{fmt(u.createdAt)}</Table.Cell>
				<Table.Cell class="text-right">
					<div class="flex justify-end gap-2">
						{#if data.can.edit}
							<Button size="sm" variant="outline" onclick={() => openEdit(u)}>Bearbeiten</Button>
							{#if u.id !== data.selfId}
								<form method="POST" action="?/setActive" use:enhance={submit()}>
									<input type="hidden" name="id" value={u.id} />
									<input type="hidden" name="active" value={String(!u.active)} />
									<Button size="sm" variant="outline" type="submit" disabled={busy}>
										{u.active ? 'Deaktivieren' : 'Aktivieren'}
									</Button>
								</form>
							{/if}
						{/if}
						{#if data.can.delete && u.id !== data.selfId}
							<Button size="sm" variant="destructive" onclick={() => openDelete(u)}>Löschen</Button>
						{/if}
					</div>
				</Table.Cell>
			</Table.Row>
		{/each}
		{#snippet footer()}
			<Pagination total={data.total} limit={data.pageSize} pageParam="page" />
		{/snippet}
	</DataTable>
</div>

<!-- Benutzer anlegen -->
<Dialog.Root bind:open={createOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Benutzer anlegen</Dialog.Title>
			<Dialog.Description
				>Das Konto wird sofort aktiv. Das Passwort muss mindestens 12 Zeichen lang sein.</Dialog.Description
			>
		</Dialog.Header>
		<form
			method="POST"
			action="?/create"
			class="space-y-4"
			use:enhance={submit(() => (createOpen = false))}
		>
			<div class="space-y-2">
				<Label for="c-name">Name</Label>
				<Input id="c-name" name="name" required maxlength={100} autocomplete="off" />
			</div>
			<div class="space-y-2">
				<Label for="c-email">E-Mail</Label>
				<Input id="c-email" name="email" type="email" required autocomplete="off" />
			</div>
			<div class="space-y-2">
				<Label for="c-pw">Passwort</Label>
				<Input
					id="c-pw"
					name="password"
					type="password"
					required
					minlength={12}
					autocomplete="new-password"
				/>
			</div>
			{#if data.can.assign && data.roles.length}
				<fieldset class="space-y-2">
					<legend class="text-sm font-medium">Rollen</legend>
					{#each data.roles as r (r.id)}
						<label class="flex items-center gap-2 text-sm" class:opacity-50={!r.assignable}>
							<input type="checkbox" name="roleIds" value={r.id} disabled={!r.assignable} />
							{r.name}
						</label>
					{/each}
				</fieldset>
			{/if}
			{#if formError}<p class="text-sm text-destructive" role="alert">{formError}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (createOpen = false)}
					>Abbrechen</Button
				>
				<Button type="submit" disabled={busy}>{busy ? 'Speichere …' : 'Anlegen'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Benutzer bearbeiten -->
<Dialog.Root bind:open={editOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Benutzer bearbeiten</Dialog.Title>
		</Dialog.Header>
		{#if editUser}
			<form
				method="POST"
				action="?/update"
				class="space-y-4"
				use:enhance={submit(() => (editOpen = false))}
			>
				<input type="hidden" name="id" value={editUser.id} />
				<div class="space-y-2">
					<Label for="e-name">Name</Label>
					<Input id="e-name" name="name" required maxlength={100} value={editUser.name} />
				</div>
				<div class="space-y-2">
					<Label for="e-email">E-Mail</Label>
					<Input id="e-email" name="email" type="email" required value={editUser.email} />
				</div>
				{#if data.can.assign && data.roles.length}
					<input type="hidden" name="rolesIncluded" value="1" />
					<fieldset class="space-y-2">
						<legend class="text-sm font-medium">Rollen</legend>
						{#each data.roles as r (r.id)}
							{@const checked = editRoleIds.includes(r.id)}
							<label
								class="flex items-center gap-2 text-sm"
								class:opacity-50={!r.assignable && !checked}
							>
								<input
									type="checkbox"
									name="roleIds"
									value={r.id}
									{checked}
									disabled={!r.assignable}
									onchange={(e) => toggleRole(r.id, e.currentTarget.checked)}
								/>
								{r.name}
							</label>
							<!-- Nicht zuweisbare, bereits gesetzte Rollen bleiben erhalten -->
							{#if !r.assignable && checked}<input type="hidden" name="roleIds" value={r.id} />{/if}
						{/each}
					</fieldset>
				{/if}
				{#if formError}<p class="text-sm text-destructive" role="alert">{formError}</p>{/if}
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (editOpen = false)}
						>Abbrechen</Button
					>
					<Button type="submit" disabled={busy}>{busy ? 'Speichere …' : 'Speichern'}</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Löschen bestätigen -->
<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Benutzer löschen?</Dialog.Title>
			<Dialog.Description>
				„{deleteUser?.name}“ ({deleteUser?.email}) wird unwiderruflich gelöscht. Alternativ können
				Sie das Konto deaktivieren.
			</Dialog.Description>
		</Dialog.Header>
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
