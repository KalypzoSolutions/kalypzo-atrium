<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toast } from 'svelte-sonner';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { formatDateTime } from '$lib/i18n/intl';
	import { t } from '$lib/i18n';
	import type { RollbackInfo } from '$lib/server/core/modules/install/manage';
	import AccountFields from '../backup/AccountFields.svelte';

	let {
		rollback,
		twoFactorEnabled,
		available,
		reason
	}: {
		rollback: RollbackInfo;
		twoFactorEnabled: boolean;
		available: boolean;
		reason: string | null;
	} = $props();

	let open = $state(false);
	let password = $state('');
	let totp = $state('');
	let fields = $state<Record<string, string>>({});
	let working = $state(false);
	let requested = $state(false);

	const withMigrations = $derived(rollback.changes.filter((c) => c.migrationsAfter));

	const onSubmit: SubmitFunction = () => {
		working = true;
		fields = {};
		return async ({ result }) => {
			working = false;
			if (result.type === 'success') {
				requested = true;
				open = false;
				password = '';
				totp = '';
				toast.success(String((result.data as { message?: string })?.message ?? ''));
			} else if (result.type === 'failure') {
				const d = (result.data ?? {}) as { message?: string; fields?: Record<string, string> };
				fields = d.fields ?? {};
				toast.error(d.message ?? t('admin-modules.actionFailed'));
			} else if (result.type === 'error') toast.error(t('admin-modules.unexpectedError'));
		};
	};
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{t('admin-modules.rollback.title')}</Card.Title>
		<Card.Description>
			{rollback.createdAt
				? t('admin-modules.rollback.descriptionAt', { at: formatDateTime(rollback.createdAt) })
				: t('admin-modules.rollback.descriptionBase')}
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3 text-sm">
		{#if rollback.changes.length}
			<ul class="list-disc pl-5">
				{#each rollback.changes as c (c.id)}
					<li>
						<code>{c.id}</code>
						{#if c.from && c.to}
							{c.from} → {c.to}
						{:else if c.from}
							{t('admin-modules.rollback.removed', { version: c.from })}
						{:else}
							{t('admin-modules.rollback.added', { version: c.to ?? '' })}
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-muted-foreground">{t('admin-modules.rollback.noChanges')}</p>
		{/if}
		{#if withMigrations.length}
			<Alert.Root variant="warning">
				<Alert.Title>{t('admin-modules.rollback.migrationsTitle')}</Alert.Title>
				<Alert.Description>
					{t('admin-modules.rollback.migrationsText', {
						list: withMigrations.map((c) => c.id).join(', ')
					})}
				</Alert.Description>
			</Alert.Root>
		{/if}
		{#if requested}
			<p class="text-muted-foreground" role="status">
				{t('admin-modules.rollback.requested')}
				<a class="text-link" href="/admin/modules/history"
					>{t('admin-modules.rollback.toHistory')}</a
				>
			</p>
		{:else if !open}
			<Button variant="outline" onclick={() => (open = true)} disabled={!available}>
				{t('admin-modules.rollback.start')}
			</Button>
			{#if !available && reason}<p class="text-xs text-muted-foreground">{reason}</p>{/if}
		{:else}
			<form
				method="POST"
				action="?/rollback"
				use:enhance={onSubmit}
				class="grid max-w-xl gap-3 sm:grid-cols-2"
			>
				<AccountFields
					idPrefix="rollback"
					bind:password
					bind:totp
					{twoFactorEnabled}
					disabled={working}
					errors={fields}
				/>
				<input type="hidden" name="password" value={password} />
				<input type="hidden" name="totp" value={totp} />
				<div class="flex flex-wrap gap-2 sm:col-span-2">
					<Button type="submit" variant="destructive-solid" disabled={working || !password}>
						{working ? t('admin-modules.pleaseWait') : t('admin-modules.rollback.confirm')}
					</Button>
					<Button type="button" variant="outline" onclick={() => (open = false)}>
						{t('admin-modules.remove.cancel')}
					</Button>
				</div>
			</form>
		{/if}
	</Card.Content>
</Card.Root>
