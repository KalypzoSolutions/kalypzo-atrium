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
	import { ColorPicker } from '$lib/components/ui/color-picker';
	import { Input } from '$lib/components/ui/input';
	import { SelectField } from '$lib/components/ui/select-field';
	import { Switch } from '$lib/components/ui/switch';
	import { FormField, NumberStepper } from '$lib/components/layout';
	import { theme, type ThemeChoice } from '$lib/theme.svelte';
	import { cn } from '$lib/utils';
	import { submitter } from './actions';
	import type { ProfileData } from './types';

	let { data }: { data: ProfileData } = $props();

	const DEFAULT_ACCENT = '#2563eb';
	const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
		{ value: 'light', label: 'Hell', icon: Sun },
		{ value: 'dark', label: 'Dunkel', icon: Moon },
		{ value: 'system', label: 'System', icon: Monitor }
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

	let busy = $state(false);
	let error = $state<string | null>(null);

	const startOptions = $derived(data.startPageOptions);

	/** Kontrast der Akzentfarbe zu weißem Text (Schaltflächen-Beschriftung) */
	function luminance(hex: string): number {
		const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
		const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
			const c = v / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
	}
	const shown = $derived(accent ?? DEFAULT_ACCENT);
	const contrast = $derived(1.05 / (luminance(shown) + 0.05));
	const lowContrast = $derived(contrast < 4.5);
	const previewStyle = $derived(`--accent-color:${shown};--primary:${shown};--ring:${shown}`);

	let previewSwitch = $state(true);
</script>

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
		},
		{ setBusy: (b) => (busy = b) }
	)}
>
	{#if error}
		<Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>
	{/if}

	<Card>
		<CardHeader><CardTitle class="font-semibold">Farbschema</CardTitle></CardHeader>
		<CardContent class="max-w-2xl space-y-6">
			<fieldset class="grid gap-2">
				<legend class="mb-1 text-sm font-medium">Darstellung</legend>
				<div class="grid gap-3 sm:grid-cols-3">
					{#each THEMES as t (t.value)}
						{@const Icon = t.icon}
						<label class="relative cursor-pointer">
							<input
								type="radio"
								name="theme-choice"
								value={t.value}
								class="peer sr-only"
								checked={selected === t.value}
								onchange={() => (picked = t.value)}
							/>
							<span
								class={cn(
									'flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-sm transition-colors',
									'hover:bg-muted peer-checked:border-primary peer-checked:ring-2 peer-checked:ring-primary/30',
									'peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50'
								)}
							>
								<Icon class="size-5" aria-hidden="true" />
								{t.label}
							</span>
						</label>
					{/each}
				</div>
			</fieldset>
			{#if themeChanged}<input type="hidden" name="theme" value={picked} />{/if}

			<div class="grid gap-3">
				<div class="flex flex-wrap items-center gap-3">
					<div class="grid gap-1.5">
						<span class="text-sm font-medium" id="accent-label">Akzentfarbe</span>
						<ColorPicker
							id="accent"
							label="Akzentfarbe"
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
						onclick={() => (accent = null)}>Zurücksetzen</Button
					>
				</div>
				<input type="hidden" name="accentColor" value={accent ?? ''} />
				<p class="text-xs text-muted-foreground" aria-live="polite">
					{#if lowContrast}
						<span class="text-amber-700 dark:text-amber-400">
							Weißer Text auf dieser Farbe ist schwer lesbar (Kontrast {contrast
								.toFixed(1)
								.replace('.', ',')} : 1, empfohlen mindestens 4,5 : 1). Wähle eine dunklere Farbe.
						</span>
					{:else}
						Kontrast {contrast.toFixed(1).replace('.', ',')} : 1 – gut lesbar.
					{/if}
				</p>

				<div class="grid gap-2 rounded-lg border bg-muted/30 p-4" style={previewStyle}>
					<p class="text-xs font-medium text-muted-foreground">Vorschau</p>
					<div class="flex flex-wrap items-center gap-3">
						<Button type="button" size="sm">Speichern</Button>
						<Switch bind:checked={previewSwitch} aria-label="Vorschau-Schalter" />
						<Badge>Neu</Badge>
						<Input class="w-40" placeholder="Fokus testen" aria-label="Vorschau-Eingabefeld" />
					</div>
				</div>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader><CardTitle class="font-semibold">Anzeige</CardTitle></CardHeader>
		<CardContent class="grid max-w-2xl gap-4">
			<FormField label="Dichte" id="density">
				<SelectField
					id="density"
					label="Dichte"
					options={[
						{ value: 'comfortable', label: 'Normal' },
						{ value: 'compact', label: 'Kompakt' }
					]}
					bind:value={() => density, (v) => (density = v ?? 'comfortable')}
				/>
			</FormField>
			<input type="hidden" name="density" value={density} />

			<FormField
				label="Einträge pro Seite"
				id="pageSize"
				hint="Gilt für Tabellen und Listen (10 bis 100)."
			>
				<NumberStepper
					id="pageSize"
					label="Einträge pro Seite"
					min={10}
					max={100}
					step={10}
					bind:value={pageSize}
				/>
			</FormField>
			<input type="hidden" name="pageSize" value={pageSize} />

			<FormField
				label="Startseite"
				id="startPage"
				hint="Diese Seite öffnet sich nach der Anmeldung."
			>
				<SelectField
					id="startPage"
					label="Startseite"
					options={startOptions}
					bind:value={() => startPage, (v) => (startPage = v ?? '/dashboard')}
				/>
			</FormField>
			<input type="hidden" name="startPage" value={startPage} />
		</CardContent>
	</Card>

	<Button type="submit" disabled={busy}>{busy ? 'Speichert …' : 'Speichern'}</Button>
</form>
