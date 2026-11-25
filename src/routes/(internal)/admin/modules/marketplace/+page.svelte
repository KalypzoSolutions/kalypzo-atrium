<script lang="ts">
	import { enhance } from '$app/forms';
	import { localized, t, intlLocale } from '$lib/i18n';
	import { normalizeSearch } from '$lib/components/layout/admin-registry';
	import { FormField, PageTitle } from '$lib/components/layout';
	import * as Alert from '$lib/components/ui/alert';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { toast } from 'svelte-sonner';
	import type { PageData, ActionData } from './$types';
	let { data, form }: { data: PageData; form: ActionData } = $props();
	let query = $state('');
	let mode = $state<'packages' | 'modules'>('packages');
	let official = $state(false);
	let categories = $state<string[]>([]);
	const allCategories = [
		'core',
		'organisation',
		'communication',
		'finance',
		'files',
		'productivity',
		'integration',
		'other'
	];
	const categoryName = (c: string) => t(`admin-marketplace.category.${c}`);
	const installed = (id: string) => data.installed.find((m) => m.id === id);
	const date = (value: string | null) =>
		value
			? new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
					new Date(value)
				)
			: '–';
	const matches = (
		source: PageData['sources'][number],
		module?: PageData['sources'][number]['modules'][number]
	) => {
		if (official && !source.official) return false;
		if (
			categories.length &&
			!categories.some((c) => source.categories.includes(c as (typeof source.categories)[number]))
		)
			return false;
		const content = [
			source.id,
			source.name,
			localized(source.description),
			source.publisher.name,
			...source.tags,
			...source.categories.map(categoryName),
			...(module
				? [module.id, localized(module.name), localized(module.description)]
				: source.modules.flatMap((m) => [m.id, localized(m.name), localized(m.description)]))
		].join(' ');
		return normalizeSearch(query)
			.split(' ')
			.filter(Boolean)
			.every((word) => normalizeSearch(content).includes(word));
	};
	let entries = $derived(
		data.sources.flatMap<{
			source: PageData['sources'][number];
			module: PageData['sources'][number]['modules'][number] | undefined;
		}>((source) =>
			mode === 'packages'
				? matches(source)
					? [{ source, module: undefined }]
					: []
				: source.modules.filter((m) => matches(source, m)).map((module) => ({ source, module }))
		)
	);
	async function copy(link: string) {
		try {
			await navigator.clipboard.writeText(new URL(link, window.location.origin).toString());
			toast.success(t('admin-marketplace.copied'));
		} catch {
			toast.error(t('admin-marketplace.copyFailed'));
		}
	}
</script>

<PageTitle title={t('admin-marketplace.title')} />
<div class="space-y-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="text-section">{t('admin-marketplace.title')}</h2>
			<p class="text-muted-foreground">{t('admin-marketplace.description')}</p>
		</div>
		{#if data.canRefresh}<form method="POST" action="?/refresh" use:enhance>
				<Button variant="outline" type="submit">{t('admin-marketplace.refresh')}</Button>
			</form>{/if}
	</div>
	<p class="text-sm break-all text-muted-foreground">
		{t('admin-marketplace.status', {
			date: date(data.marketplace.fetchedAt),
			url: data.marketplace.url || '–'
		})}
	</p>
	{#if data.marketplace.status === 'stale'}<Alert.Root variant="warning"
			><Alert.Description
				>{t('admin-marketplace.stale', {
					date: date(data.marketplace.fetchedAt)
				})}</Alert.Description
			></Alert.Root
		>{/if}
	{#if data.marketplace.status === 'incompatible'}<Alert.Root variant="warning"
			><Alert.Description>{t('admin-marketplace.incompatible')}</Alert.Description></Alert.Root
		>{/if}
	{#if data.marketplace.status === 'disabled'}<Alert.Root variant="info"
			><Alert.Description>{t('admin-marketplace.disabled')}</Alert.Description></Alert.Root
		>{/if}
	{#if !data.marketplace.index && data.marketplace.status !== 'disabled'}
		<Alert.Root variant="info"
			><Alert.Title>{t('admin-marketplace.offlineTitle')}</Alert.Title><Alert.Description
				>{t('admin-marketplace.offline')}
				<a href="/admin/modules/install" class="text-link underline"
					>{t('admin-marketplace.installByLink')}</a
				></Alert.Description
			></Alert.Root
		>
	{/if}
	<Alert.Root variant="warning"
		><Alert.Description>{t('admin-marketplace.security')}</Alert.Description></Alert.Root
	>
	{#if data.canInstall}
		<details class="rounded-lg border p-4" open={!!form && 'fields' in form}>
			<summary class="cursor-pointer font-medium">{t('admin-marketplace.settings')}</summary>
			<form method="POST" action="?/saveUrl" class="mt-4 space-y-3">
				<FormField
					id="marketplace-url"
					label={t('admin-marketplace.url')}
					hint={t('admin-marketplace.urlHint')}
					error={form && 'fields' in form ? form.fields?.url : undefined}
					><Input id="marketplace-url" name="url" value={data.marketplace.url} /></FormField
				>
				<Button type="submit" variant="outline">{t('admin-marketplace.save')}</Button>
				{#if form && 'saved' in form}<p role="status" class="text-sm">
						{t('admin-marketplace.saved')}
					</p>{/if}
			</form>
		</details>
	{/if}
	{#if data.marketplace.index}
		<div class="space-y-4">
			<div class="flex flex-wrap gap-2" aria-label={t('admin-marketplace.view')}>
				<Button
					variant={mode === 'packages' ? 'default' : 'outline'}
					onclick={() => (mode = 'packages')}
					aria-pressed={mode === 'packages'}>{t('admin-marketplace.packages')}</Button
				>
				<Button
					variant={mode === 'modules' ? 'default' : 'outline'}
					onclick={() => (mode = 'modules')}
					aria-pressed={mode === 'modules'}>{t('admin-marketplace.modules')}</Button
				>
			</div>
			<FormField id="marketplace-search" label={t('admin-marketplace.search')}
				><Input id="marketplace-search" bind:value={query} /></FormField
			>
			<fieldset class="space-y-2">
				<legend class="text-sm font-medium">{t('admin-marketplace.categories')}</legend>
				<div class="flex flex-wrap gap-2">
					{#each allCategories as c (c)}<Button
							size="sm"
							variant={categories.includes(c) ? 'default' : 'outline'}
							aria-pressed={categories.includes(c)}
							onclick={() =>
								(categories = categories.includes(c)
									? categories.filter((v) => v !== c)
									: [...categories, c])}>{categoryName(c)}</Button
						>{/each}
				</div>
			</fieldset>
			<div class="flex items-center gap-2">
				<Checkbox
					id="official"
					checked={official}
					onCheckedChange={(v) => (official = v === true)}
				/><Label for="official">{t('admin-marketplace.onlyOfficial')}</Label>
			</div>
		</div>
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each entries as entry (`${entry.source.id}:${entry.module?.id ?? ''}`)}
				{@const source = entry.source}{@const mod = entry.module}{@const already = mod
					? !!installed(mod.id)
					: source.modules.some((m) => !!installed(m.id))}{@const link =
					mod?.installLink ?? source.installLink}
				<Card.Root class="flex flex-col"
					><Card.Header
						><Card.Title>{mod ? localized(mod.name) : source.name}</Card.Title><Card.Description
							>{mod ? localized(mod.description) : localized(source.description)}</Card.Description
						></Card.Header
					>
					<Card.Content class="flex flex-1 flex-col gap-4">
						<div class="flex flex-wrap gap-2">
							<Badge variant="secondary">{source.publisher.name}</Badge>{#if source.official}<Badge
									variant="success">{t('admin-marketplace.official')}</Badge
								>{/if}{#each source.categories as c (c)}<Badge variant="outline"
									>{categoryName(c)}</Badge
								>{/each}{#if source.license}<Badge variant="outline">{source.license}</Badge>{/if}
						</div>
						{#if mod}<p class="text-sm text-muted-foreground">
								{t('admin-marketplace.packageName', { name: source.name })}
							</p>{/if}
						<ul class="space-y-1 text-sm">
							{#each mod ? [mod] : source.modules as m (m.id)}<li
									class="flex flex-wrap items-center gap-2"
								>
									<span
										>{localized(m.name)}
										<code class="text-xs text-muted-foreground">{m.id}</code></span
									>{#if installed(m.id)}<Badge variant="secondary"
											>{t('admin-marketplace.installed', { version: installed(m.id)!.version })} · {t(
												installed(m.id)!.enabled
													? 'admin-marketplace.active'
													: 'admin-marketplace.inactive'
											)}</Badge
										>{/if}
								</li>{/each}
						</ul>
						<div class="flex flex-wrap gap-3 text-sm">
							<a
								class="text-link underline"
								href={source.repository}
								target="_blank"
								rel="noopener noreferrer">{t('admin-marketplace.repository')}</a
							>{#if source.homepage}<a
									class="text-link underline"
									href={source.homepage}
									target="_blank"
									rel="noopener noreferrer">{t('admin-marketplace.homepage')}</a
								>{/if}
						</div>
						<div class="mt-auto">
							{#if data.canInstall}<Button href={link}
									>{t(
										already ? 'admin-marketplace.reinstall' : 'admin-marketplace.install'
									)}</Button
								>{:else}<Button variant="outline" onclick={() => copy(link)}
									>{t('admin-marketplace.copy')}</Button
								>{/if}
						</div>
					</Card.Content></Card.Root
				>
			{:else}<p class="text-muted-foreground">{t('admin-marketplace.empty')}</p>{/each}
		</div>
	{/if}
</div>
