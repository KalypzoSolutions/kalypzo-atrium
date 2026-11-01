<script lang="ts">
	import { t } from '$lib/i18n';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Switch } from '$lib/components/ui/switch';
	import { Button } from '$lib/components/ui/button';
	import SelectField from '$lib/components/ui/select-field/select-field.svelte';
	import NumberStepper from '$lib/components/layout/NumberStepper.svelte';
	import AssistRichTextEditor from '$lib/components/layout/writing-assistant/AssistRichTextEditor.svelte';
	import AssistButton from '$lib/components/layout/writing-assistant/AssistButton.svelte';
	import type { AssistConfig } from '$lib/components/layout/writing-assistant/assist.svelte';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import {
		getFieldType,
		listFieldTypes,
		plainToRichText,
		richTextToPlain,
		slugKey,
		type FieldDefinition,
		type FieldOption,
		type FieldType
	} from '$lib/forms';

	let {
		field = $bindable(),
		disabled = false,
		existingKeys,
		error,
		allowedTypes,
		keyLocked = false,
		assist
	}: {
		field: FieldDefinition;
		disabled?: boolean;
		/** Schlüssel aller ANDEREN Felder (Eindeutigkeitsprüfung) */
		existingKeys: string[];
		error?: string;
		/** Typen, auf die gewechselt werden darf (Standard: alle registrierten) */
		allowedTypes?: FieldType[];
		/** Schlüssel schreibgeschützt (z. B. bereits Antworten gespeichert) */
		keyLocked?: boolean;
		/** KI-Schreibhilfe: Infotexte mit diesem Zweck, Beschriftungen mit `form-label` */
		assist?: AssistConfig;
	} = $props();

	// Beschriftung nur für echte Eingabefelder (Infotext/Abschnitt haben eigene Texte)
	const labelAssist = $derived<AssistConfig | undefined>(
		assist && !field.locked && field.type !== 'info' && field.type !== 'section'
			? { ...assist, purpose: 'form-label' }
			: undefined
	);

	const uid = $props.id();
	const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
	const MAX_OPTIONS = 100;

	let advanced = $state(false);
	let bulk = $state('');

	const typeOptions = $derived(
		listFieldTypes()
			.filter(
				(t) => t.type === field.type || !allowedTypes || allowedTypes.includes(t.type as FieldType)
			)
			.map((t) => ({ value: t.type as string, label: t.label }))
	);

	const keyError = $derived(
		!KEY_RE.test(field.key)
			? t('form-builder.editor.keyInvalid')
			: existingKeys.includes(field.key)
				? t('form-builder.editor.keyTaken')
				: undefined
	);

	/** Feld mit Antwort (nicht Infotext/Abschnitt): Pflicht, Hilfetext, Gesundheitsdaten möglich */
	const hasValue = $derived(getFieldType(field.type).hasValue);
	const hasRequired = $derived(hasValue);
	/** Kennzeichen „Gesundheitsdaten“ nur für Felder mit Antwort (nicht Info/Zustimmung) */
	const hasHealthFlag = $derived(hasValue && field.type !== 'consent');
	/** Infotext als HTML für den Editor (ältere Infotexte sind einfacher Text) */
	const infoHtml = $derived(
		field.type === 'info'
			? field.format === 'html'
				? field.text
				: plainToRichText(field.text)
			: ''
	);
	const keyReadonly = $derived(disabled || field.locked || keyLocked);

	function changeType(next: string | null) {
		if (!next || next === field.type || field.locked) return;
		const created = getFieldType(next).create(field.id, field.key) as unknown as Record<
			string,
			unknown
		>;
		const old = field as unknown as Record<string, unknown>;
		const out: Record<string, unknown> = { ...created };
		for (const k of ['label', 'help', 'required', 'hidden', 'health']) {
			if (old[k] !== undefined) out[k] = old[k];
		}
		// nur Werte übernehmen, die für den neuen Typ dieselbe Bedeutung haben
		for (const k of ['maxLength', 'placeholder', 'options', 'text']) {
			if (old[k] !== undefined && k in created) out[k] = old[k];
		}
		// Text zwischen formatiert (Infotext) und einfach (Abschnitt, Zustimmung) umwandeln
		if (typeof out.text === 'string' && out.text === old.text) {
			const wasHtml = old.format === 'html';
			if (out.type === 'info' && !wasHtml) out.text = plainToRichText(out.text);
			else if (out.type !== 'info' && wasHtml) out.text = richTextToPlain(out.text);
			if (out.type === 'section') out.text = (out.text as string).slice(0, 500) || undefined;
		}
		field = out as unknown as FieldDefinition;
	}

	// --- Optionen ---------------------------------------------------------------------------
	function deriveValue(label: string): string {
		return slugKey(label) || '';
	}
	function uniqueValue(base: string, taken: string[]): string {
		const b = base || 'option';
		if (!taken.includes(b)) return b;
		let n = 2;
		while (taken.includes(`${b}_${n}`)) n++;
		return `${b}_${n}`;
	}
	function setOptions(options: FieldOption[]) {
		if (field.type === 'select' || field.type === 'multiselect') field.options = options;
	}
	function editLabel(i: number, label: string) {
		if (field.type !== 'select' && field.type !== 'multiselect') return;
		const cur = field.options[i];
		if (!cur) return;
		const auto = cur.value === '' || cur.value === deriveValue(cur.label);
		const others = field.options.filter((_, j) => j !== i).map((o) => o.value);
		const value = auto ? uniqueValue(deriveValue(label), others) : cur.value;
		setOptions(field.options.map((o, j) => (j === i ? { label, value } : o)));
	}
	function editValue(i: number, value: string) {
		if (field.type !== 'select' && field.type !== 'multiselect') return;
		setOptions(field.options.map((o, j) => (j === i ? { ...o, value } : o)));
	}
	function addOption() {
		if (field.type !== 'select' && field.type !== 'multiselect') return;
		if (field.options.length >= MAX_OPTIONS) return;
		const taken = field.options.map((o) => o.value);
		const n = field.options.length + 1;
		setOptions([...field.options, { label: '', value: uniqueValue(`option_${n}`, taken) }]);
	}
	function removeOption(i: number) {
		if (field.type !== 'select' && field.type !== 'multiselect') return;
		setOptions(field.options.filter((_, j) => j !== i));
	}
	function moveOption(i: number, d: -1 | 1) {
		if (field.type !== 'select' && field.type !== 'multiselect') return;
		const j = i + d;
		if (j < 0 || j >= field.options.length) return;
		const next = [...field.options];
		const a = next[i];
		const b = next[j];
		if (!a || !b) return;
		next[i] = b;
		next[j] = a;
		setOptions(next);
	}
	function addBulk() {
		if (field.type !== 'select' && field.type !== 'multiselect') return;
		const next = [...field.options];
		const taken = next.map((o) => o.value);
		for (const line of bulk.split(/\r?\n/)) {
			const label = line.trim();
			if (!label || next.length >= MAX_OPTIONS) continue;
			if (next.some((o) => o.label === label)) continue;
			const value = uniqueValue(deriveValue(label), taken);
			taken.push(value);
			next.push({ label, value });
		}
		setOptions(next);
		bulk = '';
	}

	function patch(p: Record<string, unknown>) {
		Object.assign(field, p);
	}
	function numOrUndef(raw: string): number | undefined {
		if (raw.trim() === '') return undefined;
		const n = Number(raw.replace(',', '.'));
		return Number.isFinite(n) ? n : undefined;
	}
	const strOrUndef = (v: string) => (v.trim() === '' ? undefined : v);

	const rowLabel = 'text-sm font-medium';
	const iconBtn = 'size-9 md:size-8';
</script>

<div class="space-y-4">
	{#if error}
		<p role="alert" class="text-xs text-destructive">{error}</p>
	{/if}

	<div class="space-y-1.5">
		<label for="{uid}-label" class={rowLabel}
			>{field.type === 'section'
				? t('form-builder.editor.heading')
				: field.type === 'info'
					? t('form-builder.editor.infoName')
					: t('form-builder.editor.label')}</label
		>
		<div class="relative">
			<Input
				id="{uid}-label"
				data-focus-first
				autocomplete="off"
				maxlength={200}
				value={field.label}
				oninput={(e) => (field.label = e.currentTarget.value)}
				{disabled}
				aria-invalid={field.label.trim() === '' ? true : undefined}
				class={['h-10 md:h-8', labelAssist && 'pr-10']}
			/>
			{#if labelAssist}
				<div class="absolute top-1/2 right-1 -translate-y-1/2">
					<AssistButton
						config={labelAssist}
						variant="icon"
						label={t('form-builder.editor.suggestLabel')}
						{disabled}
						text={() => field.label}
						onapply={(v) => (field.label = v.slice(0, 200))}
					/>
				</div>
			{/if}
		</div>
	</div>

	{#if hasValue}
		<div class="space-y-1.5">
			<label for="{uid}-help" class={rowLabel}>{t('form-builder.editor.help')}</label>
			<Input
				id="{uid}-help"
				autocomplete="off"
				maxlength={300}
				value={field.help ?? ''}
				oninput={(e) => (field.help = strOrUndef(e.currentTarget.value))}
				{disabled}
				class="h-10 md:h-8"
			/>
		</div>
	{/if}

	<div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-6">
		{#if hasRequired}
			<div class="flex min-h-9 items-center gap-2">
				<Switch
					id="{uid}-required"
					checked={field.mandatory === true || field.required === true}
					onCheckedChange={(c) => (field.required = c)}
					disabled={disabled || field.mandatory === true}
				/>
				<label for="{uid}-required" class="text-sm">{t('form-builder.editor.required')}</label>
			</div>
		{/if}
		{#if field.locked && !field.mandatory}
			<div class="flex min-h-9 items-center gap-2">
				<Switch
					id="{uid}-hidden"
					checked={field.hidden === true}
					onCheckedChange={(c) => (field.hidden = c)}
					{disabled}
				/>
				<label for="{uid}-hidden" class="text-sm">{t('form-builder.editor.hide')}</label>
			</div>
		{/if}
		{#if hasHealthFlag}
			<div class="flex min-h-9 items-center gap-2">
				<Switch
					id="{uid}-health"
					checked={field.health === true}
					onCheckedChange={(c) => (field.health = c ? true : undefined)}
					disabled={disabled || field.locked === true}
				/>
				<label for="{uid}-health" class="text-sm">{t('form-builder.editor.health')}</label>
			</div>
		{/if}
	</div>
	{#if field.mandatory}
		<p class="text-xs text-muted-foreground">
			{t('form-builder.editor.mandatoryHint')}
		</p>
	{:else if field.health && !field.locked}
		<p class="text-xs text-muted-foreground">
			{t('form-builder.editor.healthHint')}
		</p>
	{/if}

	{#if !field.locked}
		<div class="space-y-1.5">
			<label for="{uid}-type" class={rowLabel}>{t('form-builder.editor.type')}</label>
			<SelectField
				id="{uid}-type"
				label={t('form-builder.editor.type')}
				options={typeOptions}
				value={field.type}
				onchange={changeType}
				{disabled}
				class="h-10 md:h-8 sm:max-w-xs"
			/>
			<p class="text-xs text-muted-foreground">
				{t('form-builder.editor.typeHint')}
			</p>
		</div>
	{/if}

	<!-- typspezifisch -->
	{#if field.type === 'text' || field.type === 'textarea'}
		<div class="space-y-1.5">
			<span class={rowLabel} id="{uid}-maxlen">{t('form-builder.editor.maxLength')}</span>
			<div class="flex flex-wrap items-center gap-3">
				<NumberStepper
					label={t('form-builder.editor.maxLength')}
					min={0}
					max={field.type === 'text' ? 500 : 5000}
					step={field.type === 'text' ? 10 : 100}
					value={field.maxLength ?? 0}
					onchange={(v) => patch({ maxLength: v > 0 ? v : undefined })}
					{disabled}
				/>
				<span class="text-xs text-muted-foreground">{t('form-builder.editor.maxLengthHint')}</span>
			</div>
		</div>
	{:else if field.type === 'number'}
		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="{uid}-min" class={rowLabel}>{t('form-builder.editor.min')}</label>
				<Input
					id="{uid}-min"
					type="number"
					inputmode="decimal"
					autocomplete="off"
					value={field.min ?? ''}
					oninput={(e) => patch({ min: numOrUndef(e.currentTarget.value) })}
					{disabled}
					class="h-10 md:h-8"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="{uid}-max" class={rowLabel}>{t('form-builder.editor.max')}</label>
				<Input
					id="{uid}-max"
					type="number"
					inputmode="decimal"
					autocomplete="off"
					value={field.max ?? ''}
					oninput={(e) => patch({ max: numOrUndef(e.currentTarget.value) })}
					{disabled}
					class="h-10 md:h-8"
				/>
			</div>
		</div>
		<div class="flex min-h-9 items-center gap-2">
			<Switch
				id="{uid}-integer"
				checked={field.integer === true}
				onCheckedChange={(c) => patch({ integer: c })}
				{disabled}
			/>
			<label for="{uid}-integer" class="text-sm">{t('form-builder.editor.integer')}</label>
		</div>
	{:else if field.type === 'date'}
		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="{uid}-dmin" class={rowLabel}>{t('form-builder.editor.dateMin')}</label>
				<Input
					id="{uid}-dmin"
					type="date"
					value={field.min ?? ''}
					oninput={(e) => patch({ min: strOrUndef(e.currentTarget.value) })}
					{disabled}
					class="h-10 md:h-8"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="{uid}-dmax" class={rowLabel}>{t('form-builder.editor.dateMax')}</label>
				<Input
					id="{uid}-dmax"
					type="date"
					value={field.max ?? ''}
					oninput={(e) => patch({ max: strOrUndef(e.currentTarget.value) })}
					{disabled}
					class="h-10 md:h-8"
				/>
			</div>
		</div>
	{:else if field.type === 'select' || field.type === 'multiselect'}
		<fieldset class="space-y-2" {disabled}>
			<legend class={rowLabel}>{t('form-builder.editor.options')}</legend>
			{#if field.options.length === 0}
				<p class="text-xs text-muted-foreground">
					{t('form-builder.editor.noOptions')}
				</p>
			{/if}
			<ul class="space-y-2">
				{#each field.options as o, i (i)}
					<li class="flex flex-wrap items-center gap-2 sm:flex-nowrap">
						<Input
							aria-label={t('form-builder.editor.optionLabel', { n: i + 1 })}
							placeholder={t('form-builder.editor.label')}
							autocomplete="off"
							maxlength={100}
							value={o.label}
							oninput={(e) => editLabel(i, e.currentTarget.value)}
							{disabled}
							class="h-10 min-w-0 flex-1 basis-40 md:h-8"
						/>
						<Input
							aria-label={t('form-builder.editor.optionValue', { n: i + 1 })}
							placeholder={t('form-builder.editor.value')}
							autocomplete="off"
							maxlength={100}
							value={o.value}
							oninput={(e) => editValue(i, e.currentTarget.value)}
							{disabled}
							class="h-10 min-w-0 flex-1 basis-32 font-mono text-xs md:h-8"
						/>
						<div class="flex shrink-0 items-center">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class={iconBtn}
								aria-label={t('form-builder.editor.optionUp', { n: i + 1 })}
								disabled={disabled || i === 0}
								onclick={() => moveOption(i, -1)}><ArrowUp /></Button
							>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class={iconBtn}
								aria-label={t('form-builder.editor.optionDown', { n: i + 1 })}
								disabled={disabled || i === field.options.length - 1}
								onclick={() => moveOption(i, 1)}><ArrowDown /></Button
							>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class={iconBtn}
								aria-label={t('form-builder.editor.optionRemove', { n: i + 1 })}
								{disabled}
								onclick={() => removeOption(i)}><Minus /></Button
							>
						</div>
					</li>
				{/each}
			</ul>
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="gap-1.5"
				disabled={disabled || field.options.length >= MAX_OPTIONS}
				onclick={addOption}><Plus />{t('form-builder.editor.addOption')}</Button
			>
			<details class="rounded-lg border p-3">
				<summary class="cursor-pointer text-sm font-medium">{t('form-builder.editor.bulk')}</summary
				>
				<div class="mt-3 space-y-2">
					<label for="{uid}-bulk" class="text-xs text-muted-foreground"
						>{t('form-builder.editor.bulkHint')}</label
					>
					<Textarea id="{uid}-bulk" rows={4} bind:value={bulk} {disabled} />
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={disabled || bulk.trim() === ''}
						onclick={addBulk}>{t('form-builder.editor.bulkApply')}</Button
					>
				</div>
			</details>
		</fieldset>

		{#if field.type === 'select'}
			<div class="flex min-h-9 items-center gap-2">
				<Switch
					id="{uid}-other"
					checked={field.allowOther === true}
					onCheckedChange={(c) => {
						if (field.type === 'select') field.allowOther = c;
					}}
					{disabled}
				/>
				<label for="{uid}-other" class="text-sm">{t('form-builder.editor.allowOther')}</label>
			</div>
		{:else}
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="space-y-1.5">
					<span class={rowLabel}>{t('form-builder.editor.minSelect')}</span>
					<div>
						<NumberStepper
							label={t('form-builder.editor.minCount')}
							min={0}
							max={field.options.length || 0}
							value={field.min ?? 0}
							onchange={(v) => {
								if (field.type === 'multiselect') field.min = v > 0 ? v : undefined;
							}}
							{disabled}
						/>
					</div>
				</div>
				<div class="space-y-1.5">
					<span class={rowLabel}>{t('form-builder.editor.maxSelect')}</span>
					<div class="flex flex-wrap items-center gap-2">
						<NumberStepper
							label={t('form-builder.editor.maxCount')}
							min={0}
							max={field.options.length || 0}
							value={field.max ?? 0}
							onchange={(v) => {
								if (field.type === 'multiselect') field.max = v > 0 ? v : undefined;
							}}
							{disabled}
						/>
						<span class="text-xs text-muted-foreground">{t('form-builder.editor.unlimited')}</span>
					</div>
				</div>
			</div>
		{/if}
	{:else if field.type === 'info'}
		<div class="space-y-1.5">
			<p class={rowLabel}>{t('form-builder.editor.text')}</p>
			<AssistRichTextEditor
				id="{uid}-text"
				label={t('form-builder.editor.infoText')}
				{assist}
				value={infoHtml}
				minHeight="8rem"
				{disabled}
				onchange={(html) => {
					if (field.type === 'info') {
						field.text = html;
						field.format = 'html';
					}
				}}
			/>
			<p class="text-xs text-muted-foreground">
				{t('form-builder.editor.infoHint')}
			</p>
		</div>
	{:else if field.type === 'section'}
		<div class="space-y-1.5">
			<label for="{uid}-subtitle" class={rowLabel}>{t('form-builder.editor.subtitle')}</label>
			<Textarea
				id="{uid}-subtitle"
				rows={2}
				maxlength={500}
				value={field.text ?? ''}
				oninput={(e) => {
					if (field.type === 'section') field.text = strOrUndef(e.currentTarget.value);
				}}
				{disabled}
			/>
		</div>
	{:else if field.type === 'consent'}
		<div class="space-y-1.5">
			<label for="{uid}-ctext" class={rowLabel}>{t('form-builder.editor.consentText')}</label>
			<Textarea
				id="{uid}-ctext"
				rows={3}
				maxlength={1000}
				value={field.text}
				oninput={(e) => {
					if (field.type === 'consent') field.text = e.currentTarget.value;
				}}
				{disabled}
			/>
		</div>
		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="{uid}-href" class={rowLabel}>{t('form-builder.editor.href')}</label>
				<Input
					id="{uid}-href"
					type="url"
					inputmode="url"
					autocomplete="off"
					placeholder="https://…"
					value={field.href ?? ''}
					oninput={(e) => {
						if (field.type === 'consent') field.href = strOrUndef(e.currentTarget.value);
					}}
					{disabled}
					class="h-10 md:h-8"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="{uid}-linklabel" class={rowLabel}>{t('form-builder.editor.linkLabel')}</label>
				<Input
					id="{uid}-linklabel"
					autocomplete="off"
					maxlength={100}
					placeholder={t('form-builder.editor.linkLabelPlaceholder')}
					value={field.linkLabel ?? ''}
					oninput={(e) => {
						if (field.type === 'consent') field.linkLabel = strOrUndef(e.currentTarget.value);
					}}
					{disabled}
					class="h-10 md:h-8"
				/>
			</div>
		</div>
	{/if}

	<!-- Erweitert -->
	<div class="rounded-lg border">
		<button
			type="button"
			class="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring"
			aria-expanded={advanced}
			aria-controls="{uid}-adv"
			onclick={() => (advanced = !advanced)}
		>
			{#if advanced}<ChevronDown class="size-4" />{:else}<ChevronRight class="size-4" />{/if}
			{t('form-builder.editor.advanced')}
		</button>
		{#if advanced}
			<div id="{uid}-adv" class="space-y-1.5 border-t p-3">
				<label for="{uid}-key" class={rowLabel}>{t('form-builder.editor.key')}</label>
				<Input
					id="{uid}-key"
					autocomplete="off"
					maxlength={40}
					value={field.key}
					oninput={(e) => (field.key = e.currentTarget.value)}
					readonly={keyReadonly}
					disabled={disabled && !keyReadonly}
					aria-invalid={keyError ? true : undefined}
					aria-describedby="{uid}-key-help"
					class="h-10 font-mono text-xs md:h-8"
				/>
				<p id="{uid}-key-help" class="text-xs text-muted-foreground">
					{t('form-builder.editor.keyHint')}
					{#if keyReadonly}{t('form-builder.editor.keyLocked')}{/if}
				</p>
			</div>
		{/if}
	</div>
	{#if keyError && !keyReadonly}
		<p role="alert" class="text-xs text-destructive">
			{t('form-builder.editor.keyError', { error: keyError })}
		</p>
	{/if}
</div>
