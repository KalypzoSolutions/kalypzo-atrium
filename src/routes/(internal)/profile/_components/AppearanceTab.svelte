<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { ColorPicker, primaryContrast } from '$lib/components/ui/color-picker';
	import { Input } from '$lib/components/ui/input';
	import { SelectField } from '$lib/components/ui/select-field';
	import { Switch } from '$lib/components/ui/switch';
	import { FormField, NumberStepper } from '$lib/components/layout';
	import { LOCALE_LABELS, LOCALES, t } from '$lib/i18n';
	import { formatNumber } from '$lib/i18n/intl';
	import { theme, type ThemeChoice } from '$lib/theme.svelte';
	import { cn } from '$lib/utils';
	import { submitter } from './actions';
	import ThemesCard from './ThemesCard.svelte';
	import type { ProfileData } from './types';

	let { data }: { data: ProfileData } = $props();

	const DEFAULT_ACCENT = '#2563eb';
	const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
		{ value: 'light', label: t('profile.appearance.light'), icon: Sun },
		{ value: 'dark', label: t('profile.appearance.dark'), icon: Moon },
		{ value: 'system', label: t('profile.appearance.system'), icon: Monitor }
	];

	const initial = untrack(() => data.settings);
	// Darstellung: gezeigt wird immer der aktuelle Stand (auch nach Umschalten in der Kopfzeile);
	// `picked` ist nur gesetzt, wenn der Nutzer hier etwas anderes gewählt hat – nur dann wird `theme` gesendet.
	let picked = $state<ThemeChoice | null>(null);
	const selected = $derived(picked ?? theme.choice);
	const themeChanged = $derived(picked !== null && picked !== theme.choice);
	let accent = $state<string | null>(initial.accentColor || null);
	let density = $state<string>(initial.density === 'compact' ? 'compact' : 'comfortable');
	let startPage = $state<string>(initial.startPage || '/dashboard');
	let pageSize = $state<number>(initial.pageSize || 25);
	// Sprache: '' = wie das System; nach dem Speichern lädt die Seite neu (Texte sind nicht reaktiv)
	const initialLocale = initial.locale ?? '';
	let locale = $state<string>(initialLocale);
	const localeOptions = LOCALES.map((code) => ({ value: code, label: LOCALE_LABELS[code] }));

	let busy = $state(false);
	let error = $state<string | null>(null);

	const startOptions = $derived(data.startPageOptions);

	const shown = $derived(accent ?? DEFAULT_ACCENT);
	// Schrift auf Primärflächen wird automatisch hell/dunkel gewählt (app.css); hier nur der erreichte Kontrast
	const contrast = $derived(primaryContrast(shown) ?? 21);
	const lowContrast = $derived(contrast < 4.5);
	const contrastText = $derived(formatNumber(contrast, 1));
	const previewStyle = $derived(`--accent-color:${shown};--primary:${shown};--ring:${shown}`);

	let previewSwitch = $state(true);

	const activeTheme = $derived(
		[...data.themes.own, ...data.themes.presets].find((t) => t.id === data.themes.activeId) ?? null
	);
	const themeAccent = $derived(!!activeTheme?.accent);
</script>

<div class="space-y-6">
	<ThemesCard themes={data.themes} />

	<form
		method="POST"
		action="?/saveSettings"
		class="space-y-6"
		use:enhance={submitter(
			(o) => {
				error = o.error;
				if (o.ok && picked) {
					// Server hat Einstellung und Cookie gesetzt: nur noch lokal anwenden (kein zweiter Request)
					theme.choice = picked;
					theme.apply();
					picked = null;
				}
				if (o.ok && locale !== initialLocale) location.reload();
			},
			{ setBusy: (b) => (busy = b) }
		)}
	>
		{#if error}
			<Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>
		{/if}

		<Card>
			<CardHeader
				><CardTitle class="font-semibold">{t('profile.appearance.colorScheme')}</CardTitle
				></CardHeader
			>
			<CardContent class="max-w-2xl space-y-6">
				<fieldset class="grid gap-2">
					<legend class="mb-1 text-sm font-medium">{t('profile.appearance.mode')}</legend>
					<div class="grid gap-3 sm:grid-cols-3">
						{#each THEMES as choice (choice.value)}
							{@const Icon = choice.icon}
							<label class="relative cursor-pointer">
								<input
									type="radio"
									name="theme-choice"
									value={choice.value}
									class="peer sr-only"
									checked={selected === choice.value}
									onchange={() => (picked = choice.value)}
								/>
								<span
									class={cn(
										'flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-sm transition-colors',
										'hover:bg-muted peer-checked:border-primary peer-checked:ring-2 peer-checked:ring-primary/30',
										'peer-focus-visible:ring-3 peer-focus-visible:ring-ring'
									)}
								>
									<Icon class="size-5" aria-hidden="true" />
									{choice.label}
								</span>
							</label>
						{/each}
					</div>
				</fieldset>
				{#if themeChanged}<input type="hidden" name="theme" value={picked} />{/if}

				<div class="grid gap-3">
					<div class="flex flex-wrap items-center gap-3">
						<div class="grid gap-1.5">
							<span class="text-sm font-medium" id="accent-label"
								>{t('profile.appearance.accent')}</span
							>
							<ColorPicker
								id="accent"
								label={t('profile.appearance.accent')}
								value={accent}
								onchange={(v) => (accent = v)}
							/>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="self-end"
							disabled={accent === null}
							onclick={() => (accent = null)}>{t('profile.appearance.reset')}</Button
						>
					</div>
					<input type="hidden" name="accentColor" value={accent ?? ''} />
					{#if themeAccent}
						<p class="text-xs text-muted-foreground">
							{t('profile.appearance.themeAccent', { name: activeTheme?.name ?? '' })}
						</p>
					{/if}
					<p class="text-xs text-muted-foreground" aria-live="polite">
						{#if lowContrast}
							<span class="text-warning">
								{t('profile.appearance.lowContrast', { contrast: contrastText })}
							</span>
						{:else}
							{t('profile.appearance.goodContrast', { contrast: contrastText })}
						{/if}
					</p>

					<div class="grid gap-2 rounded-lg border bg-muted/30 p-4" style={previewStyle}>
						<p class="text-xs font-medium text-muted-foreground">
							{t('profile.appearance.preview')}
						</p>
						<div class="flex flex-wrap items-center gap-3">
							<Button type="button" size="sm">{t('profile.save')}</Button>
							<Switch
								bind:checked={previewSwitch}
								aria-label={t('profile.appearance.previewSwitch')}
							/>
							<Badge>{t('profile.appearance.previewBadge')}</Badge>
							<Input
								class="w-40"
								placeholder={t('profile.appearance.previewPlaceholder')}
								aria-label={t('profile.appearance.previewInput')}
							/>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader
				><CardTitle class="font-semibold">{t('profile.appearance.display')}</CardTitle></CardHeader
			>
			<CardContent class="grid max-w-2xl gap-4">
				<FormField
					label={t('profile.appearance.language')}
					id="locale"
					hint={t('profile.appearance.languageHint')}
				>
					<SelectField
						id="locale"
						label={t('profile.appearance.language')}
						options={localeOptions}
						emptyLabel={t('profile.appearance.languageSystem')}
						bind:value={() => locale || null, (v) => (locale = v ?? '')}
					/>
				</FormField>
				<input type="hidden" name="locale" value={locale} />

				<FormField label={t('profile.appearance.density')} id="density">
					<SelectField
						id="density"
						label={t('profile.appearance.density')}
						options={[
							{ value: 'comfortable', label: t('profile.appearance.densityNormal') },
							{ value: 'compact', label: t('profile.appearance.densityCompact') }
						]}
						bind:value={() => density, (v) => (density = v ?? 'comfortable')}
					/>
				</FormField>
				<input type="hidden" name="density" value={density} />

				<FormField
					label={t('profile.appearance.pageSize')}
					id="pageSize"
					hint={t('profile.appearance.pageSizeHint')}
				>
					<NumberStepper
						id="pageSize"
						label={t('profile.appearance.pageSize')}
						min={10}
						max={100}
						step={10}
						bind:value={pageSize}
					/>
				</FormField>
				<input type="hidden" name="pageSize" value={pageSize} />

				<FormField
					label={t('profile.appearance.startPage')}
					id="startPage"
					hint={t('profile.appearance.startPageHint')}
				>
					<SelectField
						id="startPage"
						label={t('profile.appearance.startPage')}
						options={startOptions}
						bind:value={() => startPage, (v) => (startPage = v ?? '/dashboard')}
					/>
				</FormField>
				<input type="hidden" name="startPage" value={startPage} />
			</CardContent>
		</Card>

		<Button type="submit" disabled={busy}>{busy ? t('profile.saving') : t('profile.save')}</Button>
	</form>
</div>
