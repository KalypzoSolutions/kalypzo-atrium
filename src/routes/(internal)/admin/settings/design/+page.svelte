<script lang="ts">
	import { enhance } from '$app/forms';
	import ImageIcon from '@lucide/svelte/icons/image';
	import { ConfirmDialog, FileField, PageTitle } from '$lib/components/layout';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { t } from '$lib/i18n';
	import { submitHandler } from '../../_shared/form-utils';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let logoOpen = $state(false);
	let logoFile = $state<File | null>(null);
	let logoBusy = $state(false);
	let logoError = $state('');
	let removeOpen = $state(false);
	let removeForm: HTMLFormElement | null = $state(null);

	const logoHandler = submitHandler({
		busy: (b) => (logoBusy = b),
		error: (m) => (logoError = m),
		success: () => (logoOpen = false)
	});
	const removeHandler = submitHandler({ busy: (b) => (logoBusy = b) });

	let preview = $state<string | null>(null);
	$effect(() => {
		if (!logoFile) {
			preview = null;
			return;
		}
		const url = URL.createObjectURL(logoFile);
		preview = url;
		return () => URL.revokeObjectURL(url);
	});

	function openDialog() {
		logoError = '';
		logoFile = null;
		logoOpen = true;
	}
</script>

<PageTitle title={t('admin-settings.design.pageTitle')} />

<Card.Root>
	<Card.Header>
		<Card.Title>{t('admin-settings.design.appearanceTitle')}</Card.Title>
		<Card.Description>{t('admin-settings.design.appearanceDescription')}</Card.Description>
	</Card.Header>
	<Card.Content>
		<SettingsForm fields={data.fields} canEdit={data.canEdit} />
	</Card.Content>
</Card.Root>

<Card.Root>
	<Card.Header>
		<Card.Title>{t('admin-settings.design.logoTitle')}</Card.Title>
		<Card.Description>
			{t('admin-settings.design.logoDescription')}
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		<div class="flex flex-wrap items-center gap-4">
			{@render logoBox(data.logoUrl, 'size-20')}
			{#if data.canUploadLogo}
				<div class="flex flex-wrap gap-2">
					<Button variant="outline" size="sm" onclick={openDialog}>
						{data.logoUrl
							? t('admin-settings.design.logoChange')
							: t('admin-settings.design.logoUpload')}
					</Button>
					{#if data.logoUrl}
						<Button variant="ghost" size="sm" onclick={() => (removeOpen = true)}
							>{t('admin-settings.design.remove')}</Button
						>
					{/if}
				</div>
			{/if}
		</div>
		{#if data.logoUrl}
			<div class="flex flex-wrap items-end gap-4">
				{#each [{ src: '/branding/favicon-32.png', label: 'Favicon', cls: 'size-8' }, { src: '/branding/apple-touch-icon.png', label: 'iPhone', cls: 'size-14 rounded-xl' }, { src: '/branding/maskable-512.png', label: 'Android', cls: 'size-14 rounded-full' }] as icon (icon.label)}
					<figure class="flex flex-col items-center gap-1">
						<img
							src="{icon.src}?v={data.logoUrl.split('v=')[1]}"
							alt={t('admin-settings.design.iconPreview', { name: icon.label })}
							class="border object-cover {icon.cls}"
						/>
						<figcaption class="text-xs text-muted-foreground">{icon.label}</figcaption>
					</figure>
				{/each}
			</div>
		{/if}
		{#if !data.canUploadLogo && data.canEdit}
			<p class="text-xs text-muted-foreground">
				{t('admin-settings.design.needStorage')}
			</p>
		{/if}
	</Card.Content>
</Card.Root>

{#snippet logoBox(src: string | null, cls: string)}
	<div
		class="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 {cls}"
	>
		{#if src}
			<img {src} alt={t('admin-settings.design.logoAlt')} class="size-full object-contain p-1" />
		{:else}
			<ImageIcon class="size-6 text-muted-foreground" aria-hidden="true" />
			<span class="sr-only">{t('admin-settings.design.noLogo')}</span>
		{/if}
	</div>
{/snippet}

<Dialog.Root bind:open={logoOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title
				>{data.logoUrl
					? t('admin-settings.design.logoChange')
					: t('admin-settings.design.logoUpload')}</Dialog.Title
			>
			<Dialog.Description>
				{t('admin-settings.design.dialogDescription')}
			</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/uploadLogo"
			enctype="multipart/form-data"
			class="grid gap-4"
			use:enhance={logoHandler}
		>
			{#if logoError}
				<Alert variant="destructive"
					><AlertDescription role="alert">{logoError}</AlertDescription></Alert
				>
			{/if}
			<div class="flex items-center gap-4">
				{@render logoBox(preview ?? data.logoUrl, 'size-[72px]')}
				<div class="min-w-0 flex-1">
					<FileField
						id="logo-file"
						name="logo"
						bind:file={logoFile}
						accept="image/png,image/jpeg,image/webp"
						maxBytes={5 * 1024 * 1024}
						crop={{
							shape: 'rect',
							aspect: 1,
							maxEdge: 1024,
							background: 'transparent',
							title: t('admin-settings.design.cropTitle')
						}}
						disabled={logoBusy}
					/>
				</div>
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (logoOpen = false)}>
					{t('admin-settings.design.cancel')}
				</Button>
				<Button type="submit" disabled={!logoFile || logoBusy}>
					{logoBusy ? t('admin-settings.design.uploading') : t('admin-settings.design.save')}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<form
	bind:this={removeForm}
	method="POST"
	action="?/removeLogo"
	class="hidden"
	use:enhance={removeHandler}
></form>

<ConfirmDialog
	bind:open={removeOpen}
	title={t('admin-settings.design.removeTitle')}
	description={t('admin-settings.design.removeDescription')}
	confirmLabel={t('admin-settings.design.remove')}
	destructive
	onconfirm={() => removeForm?.requestSubmit()}
/>
