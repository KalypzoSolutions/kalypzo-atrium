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
	import { t } from '$lib/i18n';
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

<PageTitle title={t('admin-roles.title')} />

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-section">{t('admin-roles.title')}</h2>
			<p class="text-sm text-muted-foreground">
				{t('admin-roles.description')}
			</p>
		</div>
		{#if data.can.create}<Button onclick={openCreate}>{t('admin-roles.create')}</Button>{/if}
	</div>

	<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
		{#each data.roles as r (r.id)}
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex items-center gap-2">
						{r.name}
						{#if r.isSystem}<Badge variant="secondary">{t('admin-roles.system')}</Badge>{/if}
						{#if !r.isSystem && r.permissions.some((p) => privilegedSet.has(p))}
							<Badge variant="destructive">{t('admin-roles.privileged')}</Badge>
						{/if}
					</Card.Title>
					<Card.Description>{r.description || t('admin-roles.noDescription')}</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-3">
					<p class="text-sm text-muted-foreground">
						{t('admin-roles.stats', { permissions: r.permissions.length, users: r.userCount })}
					</p>
					<div class="flex gap-2">
						<Button size="sm" variant="outline" onclick={() => openEdit(r)}>
							{editable(r) ? t('admin-roles.edit') : t('admin-roles.view')}
						</Button>
						{#if data.can.delete && !r.isSystem}
							<Button
								size="sm"
								variant="destructive"
								onclick={() => ((toDelete = r), (formError = ''), (deleteOpen = true))}
							>
								{t('admin-roles.delete')}
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
				{editing
					? locked
						? t('admin-roles.dialogView')
						: t('admin-roles.dialogEdit')
					: t('admin-roles.create')}
			</Dialog.Title>
			<Dialog.Description>
				{#if editing?.isSystem}
					{t('admin-roles.systemLocked')}
				{:else}
					{t('admin-roles.ownOnly')}
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		{#if hasPrivileged}
			<Alert.Root variant="warning">
				<Alert.Title>{t('admin-roles.privilegedTitle')}</Alert.Title>
				<Alert.Description>
					{data.isAdministrator
						? t('admin-roles.privilegedText')
						: t('admin-roles.privilegedTextLocked')}
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
				<Label for="r-name">{t('admin-roles.name')}</Label>
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
				<Label for="r-desc">{t('admin-roles.descriptionLabel')}</Label>
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
									onclick={() => toggleGroup(items, true)}>{t('admin-roles.all')}</button
								>
								<button
									type="button"
									class="text-xs font-normal text-link underline"
									onclick={() => toggleGroup(items, false)}>{t('admin-roles.none')}</button
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
											<Badge variant="destructive" class="ml-1">{t('admin-roles.privileged')}</Badge
											>
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
					{locked ? t('admin-roles.close') : t('admin-roles.cancel')}
				</Button>
				{#if !locked}
					<Button type="submit" disabled={busy}
						>{busy ? t('admin-roles.saving') : t('admin-roles.save')}</Button
					>
				{/if}
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{t('admin-roles.deleteTitle')}</Dialog.Title>
			<Dialog.Description>
				{t('admin-roles.deleteText', {
					name: toDelete?.name ?? '',
					count: toDelete?.userCount ?? 0
				})}
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/delete" use:enhance={handler(() => (deleteOpen = false))}>
			<input type="hidden" name="id" value={toDelete?.id ?? ''} />
			{#if formError}<p class="mb-3 text-sm text-destructive" role="alert">{formError}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (deleteOpen = false)}
					>{t('admin-roles.cancel')}</Button
				>
				<Button type="submit" variant="destructive" disabled={busy}
					>{t('admin-roles.delete')}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
