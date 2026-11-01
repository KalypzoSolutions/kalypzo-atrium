<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Wand from '@lucide/svelte/icons/wand-sparkles';
	import {
		deriveDark,
		previewBackground,
		SIDEBAR_CSS,
		textContrast,
		themeCssVars,
		THEME_NAME_MAX,
		userThemeSchema,
		type SidebarStyle,
		type UserTheme
	} from '$lib/appearance';
	import { applyThemeVars } from '$lib/appearance/apply';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { ColorPicker } from '$lib/components/ui/color-picker';
	import * as Dialog from '$lib/components/ui/dialog';
	import { GradientEditor } from '$lib/components/ui/gradient-editor';
	import { Input } from '$lib/components/ui/input';
	import { SegmentedSlider } from '$lib/components/ui/segmented-slider';
	import { Slider } from '$lib/components/ui/slider';
	import { Switch } from '$lib/components/ui/switch';
	import * as Tabs from '$lib/components/ui/tabs';
	import { FormField } from '$lib/components/layout';
	import { t } from '$lib/i18n';
	import { formatNumber } from '$lib/i18n/intl';
	import { theme as colorScheme } from '$lib/theme.svelte';
	import { callAction } from './actions';

	let {
		open = $bindable(false),
		theme,
		isNew
	}: {
		open?: boolean;
		/** Ausgangsstand (wird kopiert) */
		theme: UserTheme;
		isNew: boolean;
	} = $props();

	const LIGHT_PRESETS = [
		'#ffffff',
		'#f1f5f9',
		'#dbeafe',
		'#e0e7ff',
		'#ede9fe',
		'#fce7f3',
		'#fee2e2',
		'#ffedd5',
		'#fef3c7',
		'#ecfccb',
		'#d1fae5',
		'#cffafe'
	];
	const DARK_PRESETS = [
		'#0a0a0a',
		'#0f172a',
		'#172554',
		'#1e1b4b',
		'#2e1065',
		'#500724',
		'#450a0a',
		'#431407',
		'#422006',
		'#1a2e05',
		'#052e16',
		'#083344'
	];
	const SIDEBAR_OPTIONS: { value: SidebarStyle; label: string }[] = [
		{ value: 'glass', label: t('profile.themeEditor.sidebarGlass') },
		{ value: 'tinted', label: t('profile.themeEditor.sidebarTinted') },
		{ value: 'solid', label: t('profile.themeEditor.sidebarSolid') }
	];

	let draft = $state<UserTheme>(untrack(() => structuredClone($state.snapshot(theme))));
	let mode = $state<'light' | 'dark'>(untrack(() => (colorScheme.dark ? 'dark' : 'light')));
	let busy = $state(false);
	let error = $state<string | null>(null);
	let useAccent = $state(untrack(() => !!theme.accent));

	const fallbackAccent = $derived((page.data.accentColor as string | undefined) ?? '#2563eb');
	const accent = $derived(useAccent && draft.accent ? draft.accent : fallbackAccent);
	const contrast = $derived(textContrast(draft[mode], mode));
	const readable = $derived(contrast.text >= 4.5 && contrast.muted >= 3);
	const fmt = (n: number) => formatNumber(n, 1);

	// Live-Vorschau auf der ganzen Seite, im gerade bearbeiteten Modus
	$effect(() => {
		if (!open) return;
		const vars = themeCssVars($state.snapshot(draft) as UserTheme);
		applyThemeVars(vars, accent);
		document.documentElement.classList.toggle('dark', mode === 'dark');
	});

	/** Vorherigen Zustand wiederherstellen (Abbrechen oder nach dem Speichern ohne Verwenden) */
	function restore() {
		applyThemeVars(
			(page.data.themeVars as Record<string, string> | null) ?? null,
			page.data.accentColor as string
		);
		colorScheme.apply();
	}

	function onOpenChange(v: boolean) {
		if (!v) restore();
	}

	async function save(activate: boolean) {
		error = null;
		const value = { ...$state.snapshot(draft), accent: useAccent ? draft.accent : '' };
		const parsed = userThemeSchema.safeParse(value);
		if (!parsed.success) {
			error = parsed.error.issues[0]?.message ?? t('profile.themeEditor.invalid');
			return;
		}
		busy = true;
		const o = await callAction('saveTheme', {
			theme: JSON.stringify(parsed.data),
			activate: activate ? '1' : ''
		});
		busy = false;
		if (!o.ok) {
			error = o.error;
			return;
		}
		open = false;
		restore();
	}
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Content class="flex flex-col sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title
				>{isNew
					? t('profile.themeEditor.newTitle')
					: t('profile.themeEditor.editTitle')}</Dialog.Title
			>
			<Dialog.Description>
				{t('profile.themeEditor.description')}
			</Dialog.Description>
		</Dialog.Header>

		<div class="-mx-4 min-h-0 flex-1 space-y-5 overflow-y-auto px-4">
			{#if error}
				<Alert variant="destructive"
					><AlertDescription role="alert">{error}</AlertDescription></Alert
				>
			{/if}

			<div class="grid gap-4 sm:grid-cols-2">
				<FormField label={t('profile.themeEditor.name')} id="theme-name" required>
					<Input id="theme-name" maxlength={THEME_NAME_MAX} bind:value={draft.name} />
				</FormField>
				<div class="grid content-start gap-2">
					<label class="flex items-center gap-2 text-sm font-medium" for="theme-own-accent">
						<Switch
							id="theme-own-accent"
							checked={useAccent}
							onCheckedChange={(v) => {
								useAccent = v;
								if (v && !draft.accent) draft.accent = fallbackAccent;
							}}
						/>
						{t('profile.themeEditor.ownAccent')}
					</label>
					{#if useAccent}
						<ColorPicker
							label={t('profile.themeEditor.accentLabel')}
							value={draft.accent || fallbackAccent}
							onchange={(c) => (draft.accent = c ?? '')}
						/>
					{:else}
						<p class="text-xs text-muted-foreground">
							{t('profile.themeEditor.accentOff')}
						</p>
					{/if}
				</div>
			</div>

			<Tabs.Root bind:value={mode} class="gap-4">
				<Tabs.List variant="line" class="w-full justify-start">
					<Tabs.Trigger value="light" class="flex-none"
						>{t('profile.themeEditor.light')}</Tabs.Trigger
					>
					<Tabs.Trigger value="dark" class="flex-none">{t('profile.themeEditor.dark')}</Tabs.Trigger
					>
				</Tabs.List>

				{#each ['light', 'dark'] as const as m (m)}
					<Tabs.Content value={m} class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_14rem]">
						<div class="grid min-w-0 content-start gap-5">
							{#if m === 'dark'}
								<div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onclick={() => (draft.dark = deriveDark($state.snapshot(draft.light)))}
									>
										<Wand />
										{t('profile.themeEditor.deriveDark')}
									</Button>
								</div>
							{/if}
							<GradientEditor
								label={m === 'light'
									? t('profile.themeEditor.backgroundLight')
									: t('profile.themeEditor.backgroundDark')}
								presets={m === 'light' ? LIGHT_PRESETS : DARK_PRESETS}
								bind:value={draft[m].background}
							/>
							<div class="grid gap-1.5">
								<span class="text-sm font-medium"
									>{t('profile.themeEditor.veil', { value: draft[m].veil })}</span
								>
								<Slider
									label={t('profile.themeEditor.veilLabel')}
									min={0}
									max={90}
									bind:value={draft[m].veil}
								/>
								<p class="text-xs text-muted-foreground">
									{t('profile.themeEditor.veilHint')}
								</p>
							</div>
							<div class="grid gap-1.5">
								<span class="text-sm font-medium">{t('profile.themeEditor.sidebar')}</span>
								<SegmentedSlider
									label={t('profile.themeEditor.sidebar')}
									options={SIDEBAR_OPTIONS}
									bind:value={draft[m].sidebar}
								/>
							</div>
						</div>

						<!-- Mini-Vorschau: Seitenleiste, Kopfzeile, Karte -->
						<div class="grid content-start gap-2">
							<span class="text-xs font-medium text-muted-foreground"
								>{t('profile.themeEditor.preview')}</span
							>
							<div
								class="flex h-44 overflow-hidden rounded-lg border"
								style:background-image={previewBackground(draft[m], m)}
								style="--accent-color:{accent}"
								data-accent-scope
								aria-hidden="true"
							>
								<div
									class="w-12 shrink-0 space-y-1.5 border-r p-2"
									style:background={SIDEBAR_CSS[draft[m].sidebar]}
								>
									<div class="h-1.5 rounded bg-primary"></div>
									<div class="h-1.5 rounded bg-muted-foreground/40"></div>
									<div class="h-1.5 rounded bg-muted-foreground/40"></div>
								</div>
								<div class="flex min-w-0 flex-1 flex-col gap-2 p-2">
									<div class="text-xs font-semibold text-foreground">
										{t('profile.themeEditor.previewHeading')}
									</div>
									<div class="text-xs leading-tight text-muted-foreground">
										{t('profile.themeEditor.previewText')}
									</div>
									<div class="rounded-md border bg-card p-2 shadow-sm">
										<div class="mb-1.5 h-1.5 w-3/4 rounded bg-muted-foreground/40"></div>
										<div class="h-4 w-12 rounded bg-primary"></div>
									</div>
								</div>
							</div>
							<p class="text-xs" aria-live="polite">
								{#if readable}
									<span class="text-muted-foreground">
										{t('profile.themeEditor.readable', { contrast: fmt(contrast.text) })}
									</span>
								{:else}
									<span class="text-warning">
										{t('profile.themeEditor.unreadable', {
											contrast: fmt(contrast.text),
											muted: fmt(contrast.muted)
										})}
									</span>
								{/if}
							</p>
						</div>
					</Tabs.Content>
				{/each}
			</Tabs.Root>
		</div>

		<Dialog.Footer>
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					open = false;
					restore();
				}}>{t('profile.themeEditor.cancel')}</Button
			>
			<Button type="button" variant="outline" disabled={busy} onclick={() => save(false)}>
				{t('profile.themeEditor.save')}
			</Button>
			<Button type="button" disabled={busy} onclick={() => save(true)}>
				{busy ? t('profile.themeEditor.saving') : t('profile.themeEditor.saveAndUse')}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
