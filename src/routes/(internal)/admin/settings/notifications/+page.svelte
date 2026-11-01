<script lang="ts">
	import { enhance } from '$app/forms';
	import { ConfirmDialog, PageTitle } from '$lib/components/layout';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { submitHandler } from '../../_shared/form-utils';
	import { t } from '$lib/i18n';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let confirmOpen = $state(false);
	let rotating = $state(false);
	let rotateForm = $state<HTMLFormElement | null>(null);
	const rotateHandler = submitHandler({ busy: (b) => (rotating = b) });
</script>

<PageTitle title={t('admin-settings.notifications.pageTitle')} />

<div class="space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>{t('admin-settings.notifications.pushTitle')}</Card.Title>
			<Card.Description>
				{t('admin-settings.notifications.pushDescription')}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<SettingsForm fields={data.fields} canEdit={data.canEdit} />
			<p class="text-muted-foreground text-sm">
				{t('admin-settings.notifications.devices')}
				<span class="text-foreground font-medium tabular-nums">{data.devices}</span>
			</p>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>{t('admin-settings.notifications.keysTitle')}</Card.Title>
			<Card.Description>
				{t('admin-settings.notifications.keysDescription')}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div>
				<div class="text-muted-foreground mb-1 text-xs">
					{t('admin-settings.notifications.publicKey')}
				</div>
				<code class="bg-muted block rounded-md px-3 py-2 text-xs break-all">{data.publicKey}</code>
			</div>
			{#if data.canEdit}
				<form method="POST" action="?/rotate" bind:this={rotateForm} use:enhance={rotateHandler}>
					<Button
						type="button"
						variant="outline"
						disabled={rotating}
						onclick={() => (confirmOpen = true)}
					>
						{t('admin-settings.notifications.rotate')}
					</Button>
				</form>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title={t('admin-settings.notifications.rotateTitle')}
	description={t('admin-settings.notifications.rotateDescription', { count: data.devices })}
	confirmLabel={t('admin-settings.notifications.rotateConfirm')}
	destructive
	onconfirm={() => rotateForm?.requestSubmit()}
/>
