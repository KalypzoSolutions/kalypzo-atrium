<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { SelectField } from '$lib/components/ui/select-field';
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
	const areaClass =
		'min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50';
</script>

<form method="POST" {action} class="space-y-5" use:enhance={handler}>
	{#each fields as f (f.key)}
		{@const id = `s-${f.key}`}
		<div class="space-y-1.5">
			{#if f.kind === 'boolean'}
				<input type="hidden" name={`has:${f.key}`} value="1" />
				<label class="flex items-center gap-2 text-sm font-medium" for={id}>
					<input
						{id}
						type="checkbox"
						name={`f:${f.key}`}
						checked={Boolean(f.value)}
						disabled={!canEdit}
					/>
					{f.label}
				</label>
			{:else}
				<Label for={id}>{f.label}</Label>
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
						<label class="flex items-center gap-2 text-xs text-muted-foreground">
							<input type="checkbox" name={`clear:${f.key}`} /> Wert entfernen
						</label>
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
				{:else if f.kind === 'list'}
					<textarea
						{id}
						name={`f:${f.key}`}
						class={areaClass}
						disabled={!canEdit}
						placeholder="Ein Eintrag pro Zeile">{listText(f.value)}</textarea
					>
				{:else if f.kind === 'json'}
					<textarea
						{id}
						name={`f:${f.key}`}
						class={areaClass}
						disabled={!canEdit}
						spellcheck="false">{jsonText(f.value)}</textarea
					>
				{:else if f.multiline}
					<textarea
						{id}
						name={`f:${f.key}`}
						class={areaClass.replace('font-mono ', '')}
						disabled={!canEdit}>{String(f.value ?? '')}</textarea
					>
				{:else}
					<Input {id} name={`f:${f.key}`} value={String(f.value ?? '')} disabled={!canEdit} />
				{/if}
			{/if}
			{#if f.description}<p class="text-xs text-muted-foreground">{f.description}</p>{/if}
		</div>
	{/each}

	{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
	{#if canEdit}
		<Button type="submit" disabled={busy}>{busy ? 'Speichere …' : submitLabel}</Button>
	{:else}
		<p class="text-sm text-muted-foreground">
			Sie haben keine Berechtigung zum Ändern dieser Einstellungen.
		</p>
	{/if}
</form>
