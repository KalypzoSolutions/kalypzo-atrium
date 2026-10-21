<script lang="ts">
	import { enhance } from '$app/forms';
	import { FormField } from '$lib/components/layout';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { ColorPicker, normalizeHex, primaryContrast } from '$lib/components/ui/color-picker';
	import { Input } from '$lib/components/ui/input';
	import { SelectField } from '$lib/components/ui/select-field';
	import { Textarea } from '$lib/components/ui/textarea';
	import { cn } from '$lib/utils';
	import { submitHandler } from './form-utils';
	import type { FieldDescriptor } from './group-form.server';

	interface Props {
		fields: FieldDescriptor[];
		action?: string;
		canEdit: boolean;
		submitLabel?: string;
	}
	let { fields, action = '?/save', canEdit, submitLabel = 'Speichern' }: Props = $props();

	let busy = $state(false);
	let error = $state('');

	const handler = submitHandler({ busy: (b) => (busy = b), error: (m) => (error = m) });

	function listText(v: unknown) {
		return Array.isArray(v) ? v.join('\n') : '';
	}
	function jsonText(v: unknown) {
		return JSON.stringify(v ?? {}, null, 2);
	}
	/** Auswahlwerte je Feld; ohne Eingabe gilt der gespeicherte Wert bzw. (wie bei nativem select) die erste Option */
	let selected = $state<Record<string, string | null>>({});
	function selectValue(f: FieldDescriptor): string | null {
		if (f.key in selected) return selected[f.key] ?? null;
		const opts = f.options ?? [];
		return opts.find((o) => o === f.value) ?? opts[0] ?? null;
	}
	/** Farbwerte je Feld (ColorPicker); ohne Eingabe der gespeicherte Wert */
	let colors = $state<Record<string, string | null>>({});
	function colorValue(f: FieldDescriptor): string | null {
		if (f.key in colors) return colors[f.key] ?? null;
		return normalizeHex(String(f.value ?? ''));
	}
</script>

<form method="POST" {action} class="space-y-5" use:enhance={handler}>
	{#each fields as f (f.key)}
		{@const id = `s-${f.key}`}
		{#if f.kind === 'boolean'}
			<div class="space-y-1.5">
				<input type="hidden" name={`has:${f.key}`} value="1" />
				<div class="flex items-center gap-2">
					<Checkbox
						{id}
						name={`f:${f.key}`}
						checked={Boolean(f.value)}
						disabled={!canEdit}
						aria-describedby={f.description ? `${id}-hint` : undefined}
					/>
					<label class="text-sm font-medium" for={id}>{f.label}</label>
				</div>
				{#if f.description}
					<p id={`${id}-hint`} class="text-xs text-muted-foreground">{f.description}</p>
				{/if}
			</div>
		{:else}
			<FormField label={f.label} {id} hint={f.description}>
				{#if f.secret}
					<Input
						{id}
						type="password"
						name={`f:${f.key}`}
						autocomplete="new-password"
						disabled={!canEdit}
						placeholder={f.isSet ? 'gesetzt – leer lassen, um beizubehalten' : 'nicht gesetzt'}
					/>
					{#if f.isSet && canEdit}
						<div class="flex items-center gap-2">
							<Checkbox id={`${id}-clear`} name={`clear:${f.key}`} />
							<label class="text-xs text-muted-foreground" for={`${id}-clear`}>Wert entfernen</label
							>
						</div>
					{/if}
				{:else if f.kind === 'number'}
					<Input
						{id}
						type="number"
						name={`f:${f.key}`}
						value={String(f.value ?? '')}
						step="any"
						disabled={!canEdit}
					/>
				{:else if f.kind === 'select'}
					<SelectField
						{id}
						name={`f:${f.key}`}
						label={f.label}
						options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
						bind:value={() => selectValue(f), (v) => (selected[f.key] = v)}
						disabled={!canEdit}
					/>
				{:else if f.kind === 'color'}
					{@const color = colorValue(f)}
					{@const ratio = color ? primaryContrast(color) : null}
					<input type="hidden" name={`f:${f.key}`} value={color ?? ''} />
					<div class="flex flex-wrap items-center gap-3">
						<ColorPicker
							{id}
							label={f.label}
							bind:value={() => colorValue(f), (v) => (colors[f.key] = v)}
							disabled={!canEdit}
						/>
						{#if color}
							<!-- Vorschau mit automatisch gewählter Schriftfarbe (hell/dunkel nach Kontrast) -->
							<span
								class="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground"
								style={`--accent-color:${color}`}
								aria-hidden="true">Vorschau</span
							>
						{/if}
					</div>
					{#if ratio !== null}
						<p
							class={cn('text-xs', ratio < 4.5 ? 'text-warning' : 'text-muted-foreground')}
							aria-live="polite"
						>
							Kontrast der Schrift auf Primärknöpfen: {ratio.toLocaleString('de-DE', {
								maximumFractionDigits: 1
							})} : 1{ratio < 4.5
								? ' – knapp unter dem Mindestwert 4,5 : 1. Wähle eine hellere oder dunklere Farbe.'
								: ''}
						</p>
					{/if}
				{:else if f.kind === 'list'}
					<Textarea
						{id}
						name={`f:${f.key}`}
						class="min-h-24 font-mono"
						disabled={!canEdit}
						placeholder="Ein Eintrag pro Zeile"
						value={listText(f.value)}
					/>
				{:else if f.kind === 'json'}
					<Textarea
						{id}
						name={`f:${f.key}`}
						class="min-h-24 font-mono"
						disabled={!canEdit}
						spellcheck="false"
						value={jsonText(f.value)}
					/>
				{:else if f.multiline}
					<Textarea
						{id}
						name={`f:${f.key}`}
						class="min-h-24"
						disabled={!canEdit}
						value={String(f.value ?? '')}
					/>
				{:else}
					<Input {id} name={`f:${f.key}`} value={String(f.value ?? '')} disabled={!canEdit} />
				{/if}
			</FormField>
		{/if}
	{/each}

	{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
	{#if canEdit}
		<Button type="submit" disabled={busy}>{busy ? 'Speichert …' : submitLabel}</Button>
	{:else}
		<p class="text-sm text-muted-foreground">
			Du hast keine Berechtigung, diese Einstellungen zu ändern.
		</p>
	{/if}
</form>
