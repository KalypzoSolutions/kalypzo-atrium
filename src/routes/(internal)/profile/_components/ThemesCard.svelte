<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Star from '@lucide/svelte/icons/star';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import {
		blankTheme,
		FAVORITES_MAX,
		previewBackground,
		THEMES_MAX,
		type ThemeMode,
		type UserTheme
	} from '$lib/appearance';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuSeparator,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { ConfirmDialog } from '$lib/components/layout';
	import { t } from '$lib/i18n';
	import { cn } from '$lib/utils';
	import { toast } from 'svelte-sonner';
	import { callAction } from './actions';
	import ThemeEditorDialog from './ThemeEditorDialog.svelte';
	import type { ProfileData } from './types';

	let { themes }: { themes: ProfileData['themes'] } = $props();

	const PLAIN: Record<'light' | 'dark', ThemeMode> = {
		light: { background: { kind: 'solid', color: '#ffffff' }, veil: 0, sidebar: 'solid' },
		dark: { background: { kind: 'solid', color: '#0a0a0a' }, veil: 0, sidebar: 'solid' }
	};

	let pending = $state<string | null>(null);
	let editorOpen = $state(false);
	let editing = $state<{ theme: UserTheme; isNew: boolean; key: number } | null>(null);
	let deleting = $state<UserTheme | null>(null);
	let confirmOpen = $state(false);
	let editorKey = 0;

	const activeId = $derived(pending ?? themes.activeId);
	const full = $derived(themes.own.length >= THEMES_MAX);

	async function activate(id: string) {
		if (id === themes.activeId) return;
		pending = id;
		await callAction('activateTheme', { id });
		pending = null;
	}

	function openEditor(theme: UserTheme, isNew: boolean) {
		editing = { theme, isNew, key: ++editorKey };
		editorOpen = true;
	}

	function copyOf(th: UserTheme, name: string): UserTheme {
		return { ...structuredClone($state.snapshot(th) as UserTheme), id: crypto.randomUUID(), name };
	}

	// Stern: sofort umschalten, bei Fehler zurück (der Toast/Fehler kommt aus `callAction`)
	let favOverride = $state<Record<string, boolean>>({});
	const isFavorite = (id: string) => favOverride[id] ?? themes.favorites.includes(id);
	const favCount = $derived(
		themes.favorites.length +
			Object.entries(favOverride).filter(([id, on]) => on && !themes.favorites.includes(id)).length
	);

	async function toggleFavorite(th: UserTheme) {
		const on = !isFavorite(th.id);
		favOverride = { ...favOverride, [th.id]: on };
		const o = await callAction('toggleFavorite', { id: th.id, on: on ? '1' : '' });
		const rest = { ...favOverride };
		delete rest[th.id];
		favOverride = rest;
		if (!o.ok) toast.error(o.error ?? t('profile.themes.favoriteFailed'));
	}

	async function remove() {
		if (!deleting) return;
		await callAction('deleteTheme', { id: deleting.id });
		deleting = null;
	}
</script>

{#snippet swatch(light: ThemeMode, dark: ThemeMode, accent: string)}
	<span class="relative flex h-16 overflow-hidden rounded-md border" aria-hidden="true">
		<span class="flex-1" style:background-image={previewBackground(light, 'light')}></span>
		<span class="flex-1" style:background-image={previewBackground(dark, 'dark')}></span>
		{#if accent}
			<span
				class="absolute right-1.5 bottom-1.5 size-3.5 rounded-full border-2 border-white shadow-sm"
				style:background-color={accent}
			></span>
		{/if}
	</span>
{/snippet}

{#snippet tile(th: UserTheme | null, own: boolean)}
	{@const id = th?.id ?? ''}
	{@const active = activeId === id}
	<div
		class={cn(
			'group relative rounded-lg border bg-card p-2 transition-colors hover:bg-muted',
			active && 'border-primary ring-2 ring-primary/30'
		)}
	>
		<button
			type="button"
			class="focus-ring grid w-full gap-1.5 rounded-md text-left"
			aria-pressed={active}
			onclick={() => activate(id)}
		>
			{@render swatch(th?.light ?? PLAIN.light, th?.dark ?? PLAIN.dark, th?.accent ?? '')}
			<span class="flex min-w-0 items-center gap-1 pr-7 text-sm">
				{#if active}<Check class="size-4 shrink-0 text-link" aria-hidden="true" />{/if}
				<span class="truncate">{th?.name ?? t('profile.themes.default')}</span>
				{#if active}<span class="sr-only">{t('profile.themes.activeSr')}</span>{/if}
			</span>
		</button>
		{#if th}
			{@const fav = isFavorite(th.id)}
			<Button
				variant="ghost"
				size="icon-sm"
				class={cn(
					'absolute top-3 right-3 bg-card/85 shadow-sm backdrop-blur-sm hover:bg-card',
					fav && 'text-warning hover:text-warning'
				)}
				aria-pressed={fav}
				aria-label={fav
					? t('profile.themes.unfavorite', { name: th.name })
					: t('profile.themes.favorite', { name: th.name })}
				title={fav ? t('profile.themes.unfavoriteTitle') : t('profile.themes.favoriteTitle')}
				disabled={!fav && favCount >= FAVORITES_MAX}
				onclick={() => toggleFavorite(th)}
			>
				<Star class={cn(fav && 'fill-current')} />
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							class="absolute right-1.5 bottom-1.5"
							aria-label={t('profile.themes.actionsFor', { name: th.name })}
						>
							<Ellipsis />
						</Button>
					{/snippet}
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{#if own}
						<DropdownMenuItem onSelect={() => openEditor(th, false)}>
							<Pencil />
							{t('profile.themes.edit')}
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={full}
							onSelect={() =>
								openEditor(
									copyOf(th, t('profile.themes.copyName', { name: th.name }).slice(0, 40)),
									true
								)}
						>
							<Copy />
							{t('profile.themes.duplicate')}
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							variant="destructive"
							onSelect={() => {
								deleting = th;
								confirmOpen = true;
							}}
						>
							<Trash2 />
							{t('profile.themes.delete')}
						</DropdownMenuItem>
					{:else}
						<DropdownMenuItem
							disabled={full}
							onSelect={() => openEditor(copyOf(th, th.name), true)}
						>
							<Pencil />
							{t('profile.themes.customize')}
						</DropdownMenuItem>
					{/if}
				</DropdownMenuContent>
			</DropdownMenu>
		{/if}
	</div>
{/snippet}

<Card>
	<CardHeader>
		<CardTitle class="font-semibold">{t('profile.themes.title')}</CardTitle>
		<CardDescription>
			{t('profile.themes.description')}
		</CardDescription>
	</CardHeader>
	<CardContent class="space-y-6">
		<section class="space-y-2" aria-labelledby="themes-presets">
			<h3 id="themes-presets" class="text-sm font-medium">{t('profile.themes.presets')}</h3>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
				{@render tile(null, false)}
				{#each themes.presets as th (th.id)}
					{@render tile(th, false)}
				{/each}
			</div>
		</section>

		<section class="space-y-2" aria-labelledby="themes-own">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h3 id="themes-own" class="text-sm font-medium">{t('profile.themes.own')}</h3>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={full}
					onclick={() => openEditor(blankTheme(crypto.randomUUID()), true)}
				>
					<Plus />
					{t('profile.themes.new')}
				</Button>
			</div>
			{#if themes.own.length}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{#each themes.own as th (th.id)}
						{@render tile(th, true)}
					{/each}
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">
					{t('profile.themes.noneOwn')}
				</p>
			{/if}
			{#if full}
				<p class="text-xs text-muted-foreground">
					{t('profile.themes.max', { max: THEMES_MAX })}
				</p>
			{/if}
		</section>
	</CardContent>
</Card>

{#if editing}
	{#key editing.key}
		<ThemeEditorDialog bind:open={editorOpen} theme={editing.theme} isNew={editing.isNew} />
	{/key}
{/if}

<ConfirmDialog
	bind:open={confirmOpen}
	title={t('profile.themes.deleteTitle')}
	description={deleting
		? t('profile.themes.deleteDescription', { name: deleting.name })
		: undefined}
	confirmLabel={t('profile.themes.delete')}
	destructive
	onconfirm={remove}
/>
