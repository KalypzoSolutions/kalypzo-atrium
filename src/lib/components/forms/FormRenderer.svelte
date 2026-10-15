<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import SelectField from '$lib/components/ui/select-field/select-field.svelte';
	import MultiSelect from '$lib/components/ui/multi-select/multi-select.svelte';
	import { cn } from '$lib/utils';
	import {
		visibleFields,
		type FieldDefinition,
		type FormDefinition,
		type FormValues
	} from '$lib/forms';

	let {
		definition,
		values = $bindable({}),
		errors = {},
		disabled = false,
		readonly = false,
		honeypot = false,
		honeypotValue = $bindable(''),
		idPrefix,
		class: className
	}: {
		definition: FormDefinition;
		values: FormValues;
		/** Fehlertexte je Feld (Schlüssel = `key` oder `id` des Feldes) */
		errors?: Record<string, string>;
		disabled?: boolean;
		readonly?: boolean;
		honeypot?: boolean;
		honeypotValue?: string;
		idPrefix?: string;
		class?: string;
	} = $props();

	const uid = $props.id();
	const prefix = $derived(idPrefix ?? `ff${uid}`);
	const OTHER = '__other__';
	const MAX_CHECKBOX_OPTIONS = 6;

	let root: HTMLElement | null = $state(null);
	/** Explizite Freitext-Auswahl je Schlüssel (sonst aus dem Wert abgeleitet) */
	let otherMode = $state<Record<string, boolean>>({});

	const fields = $derived(visibleFields(definition));
	const ro = $derived(disabled || readonly);

	const fid = (f: FieldDefinition, part = 'input') => `${prefix}-${f.id}-${part}`;
	const errorOf = (f: FieldDefinition): string | undefined => errors[f.key] ?? errors[f.id];
	const describedBy = (f: FieldDefinition) =>
		[f.help ? fid(f, 'help') : '', errorOf(f) ? fid(f, 'err') : ''].filter(Boolean).join(' ') ||
		undefined;

	const str = (f: FieldDefinition): string => {
		const v = values[f.key];
		return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
	};
	const strList = (f: FieldDefinition): string[] => {
		const v = values[f.key];
		return Array.isArray(v) ? v : [];
	};
	const set = (f: FieldDefinition, v: FormValues[string]) => {
		values[f.key] = v;
	};
	const txt = (el: HTMLInputElement | HTMLTextAreaElement) => (el.value === '' ? null : el.value);

	type SelectDef = Extract<FieldDefinition, { type: 'select' }>;

	function isOther(f: SelectDef): boolean {
		if (!f.allowOther) return false;
		if (f.key in otherMode) return otherMode[f.key] ?? false;
		const v = values[f.key];
		return typeof v === 'string' && v !== '' && !f.options.some((o) => o.value === v);
	}

	function selectValue(f: SelectDef): string | null {
		if (isOther(f)) return OTHER;
		const v = values[f.key];
		return typeof v === 'string' && v !== '' ? v : null;
	}

	function onSelect(f: SelectDef, v: string | null) {
		if (v === OTHER) {
			otherMode[f.key] = true;
			set(f, null);
		} else {
			otherMode[f.key] = false;
			set(f, v);
		}
	}

	function toggleMulti(f: FieldDefinition, value: string, on: boolean) {
		const cur = strList(f);
		set(f, on ? [...cur.filter((x) => x !== value), value] : cur.filter((x) => x !== value));
	}

	/** Fokussiert das erste Feld mit Fehler und scrollt es in den Sichtbereich. */
	export function focusFirstError(): boolean {
		if (!root) return false;
		const first = fields.find((f) => errorOf(f));
		if (!first) return false;
		const wrap = root.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(first.id)}"]`);
		if (!wrap) return false;
		const target = wrap.querySelector<HTMLElement>(
			'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [role="combobox"]'
		);
		wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
		target?.focus({ preventScroll: true });
		return true;
	}

	const labelCls = 'text-sm font-medium leading-snug';
	const helpCls = 'text-xs text-muted-foreground';
	const errCls = 'text-xs text-destructive';
</script>

{#snippet req(f: FieldDefinition)}
	{#if f.required}<span class="ml-0.5 text-destructive" aria-hidden="true">*</span><span
			class="sr-only">(Pflichtfeld)</span
		>{/if}
{/snippet}

{#snippet meta(f: FieldDefinition)}
	{#if f.help}
		<p id={fid(f, 'help')} class={helpCls}>{f.help}</p>
	{/if}
	{#if errorOf(f)}
		<p id={fid(f, 'err')} role="alert" class={errCls}>{errorOf(f)}</p>
	{/if}
{/snippet}

<div bind:this={root} class={cn('relative space-y-5', className)}>
	{#each fields as f (f.id)}
		{@const err = errorOf(f)}
		<div data-field-id={f.id} class="space-y-1.5">
			{#if f.type === 'info'}
				<p class="text-sm whitespace-pre-line text-foreground">{f.text}</p>
			{:else if f.type === 'boolean'}
				<div class="flex items-start gap-3">
					<Checkbox
						id={fid(f)}
						class="mt-0.5"
						checked={values[f.key] === true}
						onCheckedChange={(c) => set(f, c === true)}
						disabled={ro}
						aria-invalid={err ? true : undefined}
						aria-describedby={describedBy(f)}
					/>
					<label for={fid(f)} class={cn(labelCls, 'cursor-pointer')}
						>{f.label}{@render req(f)}</label
					>
				</div>
				{@render meta(f)}
			{:else if f.type === 'consent'}
				<div class="flex items-start gap-3">
					<Checkbox
						id={fid(f)}
						class="mt-0.5"
						checked={values[f.key] === true}
						onCheckedChange={(c) => set(f, c === true)}
						disabled={ro}
						aria-invalid={err ? true : undefined}
						aria-describedby={describedBy(f)}
					/>
					<div class="text-sm leading-snug">
						<label for={fid(f)} class="block cursor-pointer">
							<span class="font-medium">{f.label}{@render req(f)}</span>
							<span class="block whitespace-pre-line text-muted-foreground">{f.text}</span>
						</label>
						{#if f.href}
							<a
								href={f.href}
								target="_blank"
								rel="noopener noreferrer"
								class="text-primary underline underline-offset-2"
								>{f.linkLabel || 'Mehr erfahren'}<span class="sr-only">
									(öffnet in neuem Tab)</span
								></a
							>
						{/if}
					</div>
				</div>
				{@render meta(f)}
			{:else if f.type === 'multiselect' && f.options.length <= MAX_CHECKBOX_OPTIONS}
				<fieldset class="space-y-2" aria-describedby={describedBy(f)}>
					<legend class={labelCls}>{f.label}{@render req(f)}</legend>
					{#if f.help}<p id={fid(f, 'help')} class={helpCls}>{f.help}</p>{/if}
					<div class="space-y-1">
						{#each f.options as o, i (o.value)}
							<div class="flex min-h-9 items-center gap-3">
								<Checkbox
									id={fid(f, `o${i}`)}
									checked={strList(f).includes(o.value)}
									onCheckedChange={(c) => toggleMulti(f, o.value, c === true)}
									disabled={ro}
									aria-invalid={err ? true : undefined}
								/>
								<label for={fid(f, `o${i}`)} class="cursor-pointer text-sm">{o.label}</label>
							</div>
						{/each}
					</div>
					{#if err}<p id={fid(f, 'err')} role="alert" class={errCls}>{err}</p>{/if}
				</fieldset>
			{:else}
				<label for={fid(f)} class={cn(labelCls, 'block')}>{f.label}{@render req(f)}</label>
				{#if f.type === 'text' || f.type === 'email' || f.type === 'phone' || f.type === 'date'}
					<Input
						id={fid(f)}
						type={f.type === 'email'
							? 'email'
							: f.type === 'phone'
								? 'tel'
								: f.type === 'date'
									? 'date'
									: 'text'}
						inputmode={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : undefined}
						autocomplete="off"
						value={str(f)}
						oninput={(e) => set(f, txt(e.currentTarget))}
						maxlength={f.type === 'text' ? f.maxLength : undefined}
						min={f.type === 'date' ? f.min : undefined}
						max={f.type === 'date' ? f.max : undefined}
						placeholder={f.type === 'text' ? f.placeholder : undefined}
						{disabled}
						{readonly}
						aria-required={f.required || undefined}
						aria-invalid={err ? true : undefined}
						aria-describedby={describedBy(f)}
						class="h-10 md:h-8"
					/>
				{:else if f.type === 'number'}
					<Input
						id={fid(f)}
						type="number"
						inputmode={f.integer ? 'numeric' : 'decimal'}
						step={f.integer ? 1 : 'any'}
						min={f.min}
						max={f.max}
						autocomplete="off"
						value={str(f)}
						oninput={(e) => {
							const n = e.currentTarget.valueAsNumber;
							set(f, e.currentTarget.value === '' || Number.isNaN(n) ? null : n);
						}}
						{disabled}
						{readonly}
						aria-required={f.required || undefined}
						aria-invalid={err ? true : undefined}
						aria-describedby={describedBy(f)}
						class="h-10 md:h-8"
					/>
				{:else if f.type === 'textarea'}
					<Textarea
						id={fid(f)}
						value={str(f)}
						oninput={(e) => set(f, txt(e.currentTarget))}
						maxlength={f.maxLength}
						placeholder={f.placeholder}
						autocomplete="off"
						{disabled}
						{readonly}
						rows={4}
						aria-required={f.required || undefined}
						aria-invalid={err ? true : undefined}
						aria-describedby={describedBy(f)}
					/>
					{#if f.maxLength}
						<p class="text-right text-xs text-muted-foreground tabular-nums" aria-hidden="true">
							{str(f).length} / {f.maxLength}
						</p>
					{/if}
				{:else if f.type === 'select'}
					<SelectField
						id={fid(f)}
						label={f.label}
						options={f.allowOther ? [...f.options, { value: OTHER, label: 'Andere …' }] : f.options}
						value={selectValue(f)}
						onchange={(v) => onSelect(f, v)}
						disabled={ro}
						invalid={!!err}
						class="h-10 md:h-8"
					/>
					{#if isOther(f)}
						<Input
							id={fid(f, 'other')}
							type="text"
							autocomplete="off"
							aria-label="{f.label}: eigene Angabe"
							placeholder="Bitte angeben"
							value={str(f)}
							oninput={(e) => set(f, txt(e.currentTarget))}
							maxlength={200}
							{disabled}
							{readonly}
							aria-invalid={err ? true : undefined}
							aria-describedby={describedBy(f)}
							class="h-10 md:h-8"
						/>
					{/if}
				{:else if f.type === 'multiselect'}
					<MultiSelect
						id={fid(f)}
						label={f.label}
						options={f.options}
						value={strList(f)}
						onchange={(v) => set(f, v)}
						disabled={ro}
						invalid={!!err}
					/>
				{/if}
				{@render meta(f)}
			{/if}
		</div>
	{/each}

	{#if honeypot}
		<div
			aria-hidden="true"
			class="pointer-events-none absolute top-auto -left-[10000px] h-px w-px overflow-hidden opacity-0"
		>
			<label for="{prefix}-website">Website (bitte leer lassen)</label>
			<input
				id="{prefix}-website"
				type="text"
				name="website"
				tabindex={-1}
				autocomplete="off"
				bind:value={honeypotValue}
			/>
		</div>
	{/if}
</div>
