<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import { enhance } from '$app/forms';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { submitHandler } from '../_shared/form-utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	type RoleRow = PageData['roles'][number];

	let formOpen = $state(false);
	let deleteOpen = $state(false);
	let busy = $state(false);
	let formError = $state('');
	let editing = $state<RoleRow | null>(null);
	let selected = $state<string[]>([]);
	let toDelete = $state<RoleRow | null>(null);

	const grantableSet = $derived(
		new Set(data.permissions.filter((p) => p.grantable).map((p) => p.key))
	);

	const groups = $derived.by(() => {
		const map = new Map<string, PageData['permissions']>();
		for (const p of data.permissions) map.set(p.moduleId, [...(map.get(p.moduleId) ?? []), p]);
		return [...map.entries()];
	});

	// Rollen darf nur bearbeiten, wer alle enthaltenen Rechte selbst besitzt
	function editable(r: RoleRow) {
		return data.can.edit && !r.isSystem && r.permissions.every((p) => grantableSet.has(p));
	}

	const locked = $derived(editing ? !editable(editing) : !data.can.create);

	const privilegedSet = $derived(
		new Set(data.permissions.filter((p) => p.privileged).map((p) => p.key))
	);
	// Hinweis zeigen, wenn admin-gleiche Rechte gewählt sind oder man sie nicht vergeben darf
	const hasPrivileged = $derived(
		privilegedSet.size > 0 && (!data.isAdministrator || selected.some((k) => privilegedSet.has(k)))
	);

	function openCreate() {
		editing = null;
		selected = [];
		formError = '';
		formOpen = true;
	}
	function openEdit(r: RoleRow) {
		editing = r;
		selected = [...r.permissions];
		formError = '';
		formOpen = true;
	}
	function toggle(key: string, on: boolean) {
		selected = on ? [...selected, key] : selected.filter((k) => k !== key);
	}
	function toggleGroup(items: PageData['permissions'], on: boolean) {
		const keys = items.filter((p) => p.grantable).map((p) => p.key);
		selected = on
			? [...new Set([...selected, ...keys])]
			: selected.filter((k) => !keys.includes(k));
	}

	const handler = (close: () => void) =>
		submitHandler({
			busy: (b) => (busy = b),
			error: (m) => (formError = m),
			success: close
		});
</script>

<PageTitle title="Rollen" />

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-section">Rollen</h2>
			<p class="text-sm text-muted-foreground">
				Berechtigungen bündeln und Benutzer*innen zuweisen.
			</p>
		</div>
		{#if data.can.create}<Button onclick={openCreate}>Rolle anlegen</Button>{/if}
	</div>

	<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
		{#each data.roles as r (r.id)}
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex items-center gap-2">
						{r.name}
						{#if r.isSystem}<Badge variant="secondary">System</Badge>{/if}
						{#if !r.isSystem && r.permissions.some((p) => privilegedSet.has(p))}
							<Badge variant="destructive">Admin-gleich</Badge>
						{/if}
					</Card.Title>
					<Card.Description>{r.description || 'Keine Beschreibung'}</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-3">
					<p class="text-sm text-muted-foreground">
						{r.permissions.length} Berechtigungen · {r.userCount} Benutzer
					</p>
					<div class="flex gap-2">
						<Button size="sm" variant="outline" onclick={() => openEdit(r)}>
							{editable(r) ? 'Bearbeiten' : 'Ansehen'}
						</Button>
						{#if data.can.delete && !r.isSystem}
							<Button
								size="sm"
								variant="destructive"
								onclick={() => ((toDelete = r), (formError = ''), (deleteOpen = true))}
							>
								Löschen
							</Button>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
</div>

<Dialog.Root bind:open={formOpen}>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>
				{editing ? (locked ? 'Rolle ansehen' : 'Rolle bearbeiten') : 'Rolle anlegen'}
			</Dialog.Title>
			<Dialog.Description>
				{#if editing?.isSystem}
					Systemrollen können nicht verändert werden.
				{:else}
					Nur Berechtigungen, die du selbst besitzt, können vergeben werden.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		{#if hasPrivileged}
			<Alert.Root variant="warning">
				<Alert.Title>Admin-gleiche Rechte</Alert.Title>
				<Alert.Description>
					Mit „Admin-gleich“ markierte Berechtigungen (Datensicherung, Zurücksetzen) erlauben
					faktisch die Übernahme des ganzen Systems und aller Daten. Nur Administrator*innen können
					sie vergeben{data.isAdministrator ? '' : ' – du kannst sie hier nicht ändern'}.
				</Alert.Description>
			</Alert.Root>
		{/if}
		<form
			method="POST"
			action={editing ? '?/update' : '?/create'}
			class="space-y-4"
			use:enhance={handler(() => (formOpen = false))}
		>
			{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
			<div class="space-y-2">
				<Label for="r-name">Name</Label>
				<Input
					id="r-name"
					name="name"
					required
					minlength={2}
					maxlength={60}
					value={editing?.name ?? ''}
					disabled={locked}
				/>
			</div>
			<div class="space-y-2">
				<Label for="r-desc">Beschreibung</Label>
				<Input
					id="r-desc"
					name="description"
					maxlength={300}
					value={editing?.description ?? ''}
					disabled={locked}
				/>
			</div>

			<div class="space-y-4">
				{#each groups as [moduleId, items] (moduleId)}
					<fieldset class="rounded-lg border p-3">
						<legend class="flex items-center gap-3 px-1 text-sm font-semibold">
							{moduleId}
							{#if !locked}
								<button
									type="button"
									class="text-xs font-normal text-link underline"
									onclick={() => toggleGroup(items, true)}>alle</button
								>
								<button
									type="button"
									class="text-xs font-normal text-link underline"
									onclick={() => toggleGroup(items, false)}>keine</button
								>
							{/if}
						</legend>
						<div class="grid gap-1 sm:grid-cols-2">
							{#each items as p (p.key)}
								{@const on = selected.includes(p.key)}
								{@const cid = `perm-${p.key.replace(/[^a-z0-9-]/g, '-')}`}
								<div class="flex items-start gap-2 text-sm" class:opacity-50={!p.grantable && !on}>
									<Checkbox
										id={cid}
										class="mt-0.5"
										aria-label={p.key}
										aria-describedby={p.description ? `${cid}-desc` : undefined}
										checked={on}
										disabled={locked || !p.grantable}
										onCheckedChange={(v) => toggle(p.key, v)}
									/>
									<label for={cid}>
										<code class="text-xs">{p.key}</code>
										{#if p.privileged}
											<Badge variant="destructive" class="ml-1">Admin-gleich</Badge>
										{/if}
										{#if p.description}
											<span id={`${cid}-desc`} class="block text-xs text-muted-foreground"
												>{p.description}</span
											>
										{/if}
									</label>
								</div>
							{/each}
						</div>
					</fieldset>
				{/each}
			</div>
			{#each selected as key (key)}<input type="hidden" name="permissions" value={key} />{/each}

			{#if formError}<p class="text-sm text-destructive" role="alert">{formError}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (formOpen = false)}>
					{locked ? 'Schließen' : 'Abbrechen'}
				</Button>
				{#if !locked}
					<Button type="submit" disabled={busy}>{busy ? 'Speichert …' : 'Speichern'}</Button>
				{/if}
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Rolle löschen?</Dialog.Title>
			<Dialog.Description>
				Die Rolle „{toDelete?.name}“ wird gelöscht und allen {toDelete?.userCount ?? 0} Benutzern entzogen.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/delete" use:enhance={handler(() => (deleteOpen = false))}>
			<input type="hidden" name="id" value={toDelete?.id ?? ''} />
			{#if formError}<p class="mb-3 text-sm text-destructive" role="alert">{formError}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (deleteOpen = false)}
					>Abbrechen</Button
				>
				<Button type="submit" variant="destructive" disabled={busy}>Löschen</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
