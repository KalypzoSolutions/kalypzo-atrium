<script lang="ts">
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Tabs from '$lib/components/ui/tabs';
	import ConfirmDialog from '$lib/components/layout/ConfirmDialog.svelte';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Copy from '@lucide/svelte/icons/copy';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import Trash from '@lucide/svelte/icons/trash';
	import FieldEditor from './FieldEditor.svelte';
	import FieldPalette, { fieldTypeIcon } from './FieldPalette.svelte';
	import FormPreviewDialog from './FormPreviewDialog.svelte';
	import FormRenderer from './FormRenderer.svelte';
	import {
		emptyValues,
		getFieldType,
		richTextToPlain,
		listFieldTypes,
		slugKey,
		type FieldDefinition,
		type FieldType,
		type FormDefinition,
		type FormValues
	} from '$lib/forms';

	let {
		definition = $bindable(),
		allowedTypes,
		maxFields = 60,
		disabled = false,
		errors = {},
		lockedKeys = [],
		onchange
	}: {
		definition: FormDefinition;
		allowedTypes?: FieldType[];
		maxFields?: number;
		disabled?: boolean;
		/** Validierungsfehler je Feld-ID */
		errors?: Record<string, string>;
		/** Schlüssel, die nicht mehr geändert werden dürfen (z. B. bereits Antworten vorhanden) */
		lockedKeys?: string[];
		onchange?: (definition: FormDefinition) => void;
	} = $props();

	const uid = $props.id();

	let tab = $state('edit');
	let expanded = $state<Record<string, boolean>>({});
	let previewValues = $state<FormValues>({});
	let announce = $state('');
	let confirmOpen = $state(false);
	let pendingDelete = $state<FieldDefinition | null>(null);
	let root: HTMLElement | null = $state(null);
	let fullscreen = $state(false);

	// --- Ziehen zum Sortieren (Maus, Stift, Touch über den Griff) ---------------------------
	let dragId = $state<string | null>(null);
	/** Reihenfolge während des Ziehens; erst beim Loslassen übernommen */
	let dragOrder = $state<FieldDefinition[] | null>(null);
	const list = $derived(dragOrder ?? definition.fields);
	let lastY = 0;
	let scrollTimer: ReturnType<typeof setInterval> | null = null;

	function startDrag(e: PointerEvent, id: string) {
		if (disabled || e.button !== 0) return;
		e.preventDefault();
		dragId = id;
		dragOrder = [...definition.fields];
		lastY = e.clientY;
		window.addEventListener('pointermove', onDragMove);
		window.addEventListener('pointerup', endDrag);
		window.addEventListener('pointercancel', cancelDrag);
		scrollTimer = setInterval(autoScroll, 16);
	}

	function onDragMove(e: PointerEvent) {
		lastY = e.clientY;
		reorderAt(e.clientY);
	}

	/** Verschiebt das gezogene Feld an die Stelle, die zur Zeigerposition passt */
	function reorderAt(y: number) {
		if (!dragId || !dragOrder || !root) return;
		const others = [...root.querySelectorAll<HTMLElement>('[data-card-id]')].filter(
			(el) => el.dataset.cardId !== dragId
		);
		let target = 0;
		for (const el of others) {
			const r = el.getBoundingClientRect();
			if (y > r.top + r.height / 2) target++;
		}
		const from = dragOrder.findIndex((f) => f.id === dragId);
		if (from < 0 || from === target) return;
		const next = [...dragOrder];
		const [moved] = next.splice(from, 1);
		next.splice(target, 0, moved!);
		dragOrder = next;
	}

	/** Am Rand des Fensters automatisch weiterscrollen */
	function autoScroll() {
		const edge = 64;
		const h = window.innerHeight;
		const d = lastY < edge ? -(edge - lastY) / 4 : lastY > h - edge ? (lastY - (h - edge)) / 4 : 0;
		if (d) {
			window.scrollBy(0, d);
			reorderAt(lastY);
		}
	}

	function stopListening() {
		window.removeEventListener('pointermove', onDragMove);
		window.removeEventListener('pointerup', endDrag);
		window.removeEventListener('pointercancel', cancelDrag);
		if (scrollTimer) clearInterval(scrollTimer);
		scrollTimer = null;
	}

	function endDrag() {
		stopListening();
		const order = dragOrder;
		const id = dragId;
		dragId = null;
		dragOrder = null;
		if (!order || !id) return;
		const changed = order.some((f, i) => f.id !== definition.fields[i]?.id);
		if (!changed) return;
		commit(order);
		const pos = order.findIndex((f) => f.id === id);
		announce = `„${order[pos]?.label}“ steht jetzt an Position ${pos + 1} von ${order.length}.`;
	}

	function cancelDrag() {
		stopListening();
		dragId = null;
		dragOrder = null;
	}

	$effect(() => () => stopListening());

	/** Kurzer Text in der Kopfzeile für Infotexte/Abschnitte */
	function summary(f: FieldDefinition): string {
		if (f.type === 'info') return f.format === 'html' ? richTextToPlain(f.text) : f.text;
		if (f.type === 'section') return f.text ?? '';
		return '';
	}

	const specs = $derived(
		listFieldTypes().filter((t) => !allowedTypes || allowedTypes.includes(t.type as FieldType))
	);
	const atLimit = $derived(definition.fields.length >= maxFields);
	const fieldCount = $derived(definition.fields.length);

	function commit(fields: FieldDefinition[]) {
		definition.fields = fields;
		onchange?.(definition);
	}

	function uniqueKey(base: string, taken: string[]): string {
		let b = (slugKey(base) || 'feld').slice(0, 36);
		if (!/^[a-zA-Z]/.test(b)) b = `f_${b}`.slice(0, 36);
		if (!taken.includes(b)) return b;
		let n = 2;
		while (taken.includes(`${b}_${n}`)) n++;
		return `${b}_${n}`;
	}

	async function focusCard(id: string, selector: string) {
		await tick();
		root?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"] ${selector}`)?.focus();
	}

	async function add(type: FieldType) {
		if (atLimit || disabled) return;
		const spec = getFieldType(type);
		const id = crypto.randomUUID();
		const key = uniqueKey(
			spec.label,
			definition.fields.map((f) => f.key)
		);
		const field = spec.create(id, key);
		commit([...definition.fields, field]);
		expanded[id] = true;
		announce = `Feld „${field.label || spec.label}“ hinzugefügt.`;
		await focusCard(id, '[data-focus-first]');
	}

	function duplicate(i: number) {
		if (atLimit || disabled) return;
		const src = definition.fields[i];
		if (!src) return;
		const id = crypto.randomUUID();
		const copy = {
			...structuredClone($state.snapshot(src)),
			id,
			key: uniqueKey(
				src.key,
				definition.fields.map((f) => f.key)
			),
			label: src.label ? `${src.label} (Kopie)` : src.label,
			locked: undefined,
			mandatory: undefined,
			hidden: undefined
		} as FieldDefinition;
		const next = [...definition.fields];
		next.splice(i + 1, 0, copy);
		commit(next);
		expanded[id] = true;
		announce = `Feld „${src.label}“ dupliziert.`;
		focusCard(id, '[data-focus-first]');
	}

	async function move(i: number, d: -1 | 1, focusOn: 'arrows' | 'grip' = 'arrows') {
		const j = i + d;
		if (j < 0 || j >= definition.fields.length || disabled) return;
		const next = [...definition.fields];
		const a = next[i];
		const f = next[j];
		if (!a || !f) return;
		next[i] = f;
		next[j] = a;
		commit(next);
		announce = `„${f.label}“ steht jetzt an Position ${j + 1} von ${next.length}.`;
		const dir = d < 0 ? 'up' : 'down';
		await tick();
		if (focusOn === 'grip') {
			root?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(a.id)}"] [data-grip]`)?.focus();
			return;
		}
		const btn = root?.querySelector<HTMLButtonElement>(
			`[data-card-id="${CSS.escape(f.id)}"] [data-move="${dir}"]`
		);
		if (btn && !btn.disabled) btn.focus();
		else
			root
				?.querySelector<HTMLElement>(
					`[data-card-id="${CSS.escape(f.id)}"] [data-move="${dir === 'up' ? 'down' : 'up'}"]`
				)
				?.focus();
	}

	function askDelete(f: FieldDefinition) {
		if (f.locked || disabled) return;
		pendingDelete = f;
		confirmOpen = true;
	}

	function doDelete() {
		const f = pendingDelete;
		pendingDelete = null;
		if (!f) return;
		commit(definition.fields.filter((x) => x.id !== f.id));
		delete expanded[f.id];
		announce = `Feld „${f.label}“ gelöscht.`;
	}

	function onTab(v: string) {
		if (v === 'preview') previewValues = emptyValues(definition);
	}

	const iconBtn = 'size-9 md:size-8';
</script>

<div bind:this={root} class="space-y-4">
	<Tabs.Root bind:value={tab} onValueChange={onTab}>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<Tabs.List>
				<Tabs.Trigger value="edit">Bearbeiten</Tabs.Trigger>
				<Tabs.Trigger value="preview">Vorschau</Tabs.Trigger>
			</Tabs.List>
			<Button variant="ghost" size="sm" onclick={() => (fullscreen = true)}>
				<Maximize2 /> Vollbild-Vorschau
			</Button>
		</div>

		<Tabs.Content value="edit" class="space-y-5 pt-4">
			<div class="grid gap-3">
				<div class="space-y-1.5">
					<label for="{uid}-title" class="text-sm font-medium">Titel (optional)</label>
					<Input
						id="{uid}-title"
						autocomplete="off"
						maxlength={200}
						value={definition.title ?? ''}
						oninput={(e) => {
							definition.title = e.currentTarget.value || undefined;
							onchange?.(definition);
						}}
						{disabled}
						class="h-10 md:h-8"
					/>
				</div>
				<div class="space-y-1.5">
					<label for="{uid}-intro" class="text-sm font-medium">Einleitung (optional)</label>
					<Textarea
						id="{uid}-intro"
						rows={3}
						maxlength={2000}
						value={definition.intro ?? ''}
						oninput={(e) => {
							definition.intro = e.currentTarget.value || undefined;
							onchange?.(definition);
						}}
						{disabled}
					/>
				</div>
			</div>

			{#if fieldCount === 0}
				<div class="rounded-xl border border-dashed p-6 text-center">
					<p class="text-sm font-medium">Noch keine Felder</p>
					<p class="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
						Füge Felder hinzu, die Teilnehmende ausfüllen sollen, z. B. Kurztext, Auswahl oder
						Zustimmung. Reihenfolge, Pflichtangaben und Optionen lassen sich jederzeit anpassen.
					</p>
				</div>
			{:else}
				<ol class="space-y-3" aria-label="Formularfelder">
					{#each list as f, i (f.id)}
						{@const spec = specs.find((s) => s.type === f.type) ?? getFieldType(f.type)}
						{@const Icon = fieldTypeIcon(spec)}
						{@const open = expanded[f.id] === true}
						{@const ferr = errors[f.id] ?? errors[f.key]}
						{@const note = summary(f)}
						<li
							data-card-id={f.id}
							animate:flip={{ duration: 150 }}
							class="rounded-xl border bg-card text-card-foreground {ferr
								? 'border-destructive'
								: ''} {f.hidden ? 'opacity-70' : ''} {dragId === f.id
								? 'relative z-10 shadow-lg ring-2 ring-ring'
								: ''}"
						>
							<div class="flex flex-wrap items-center gap-1 p-2 sm:flex-nowrap">
								{#if !disabled}
									<button
										type="button"
										data-grip
										class="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring active:cursor-grabbing md:size-8"
										aria-label="„{f.label}“ verschieben (ziehen oder Pfeiltasten)"
										onpointerdown={(e) => startDrag(e, f.id)}
										onkeydown={(e) => {
											if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
												e.preventDefault();
												void move(i, e.key === 'ArrowUp' ? -1 : 1, 'grip');
											}
										}}
									>
										<GripVertical class="size-4" aria-hidden="true" />
									</button>
								{/if}
								<button
									type="button"
									class="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring"
									aria-expanded={open}
									aria-controls="{uid}-{f.id}-panel"
									onclick={() => (expanded[f.id] = !open)}
								>
									{#if open}<ChevronDown class="size-4 shrink-0" />{:else}<ChevronRight
											class="size-4 shrink-0"
										/>{/if}
									<Icon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
									<span class="flex min-w-0 flex-1 flex-col">
										<span
											class="truncate text-sm {f.type === 'section'
												? 'font-semibold'
												: 'font-medium'}"
										>
											{f.label || '(ohne Beschriftung)'}
											<span class="sr-only">, {spec.label}</span>
										</span>
										{#if note}
											<span class="truncate text-xs font-normal text-muted-foreground">{note}</span>
										{/if}
									</span>
								</button>
								<div class="flex flex-wrap items-center gap-1">
									{#if f.required}<Badge variant="secondary">Pflicht</Badge>{/if}
									{#if f.locked}<Badge variant="outline">Standardfeld</Badge>{/if}
									{#if f.hidden}<Badge variant="outline">Ausgeblendet</Badge>{/if}
									{#if f.health}<Badge variant="outline">Gesundheitsdaten</Badge>{/if}
								</div>
								<div class="ml-auto flex shrink-0 items-center">
									<Button
										type="button"
										variant="ghost"
										size="icon"
										class={iconBtn}
										data-move="up"
										aria-label="„{f.label}“ nach oben"
										disabled={disabled || i === 0}
										onclick={() => move(i, -1)}><ArrowUp /></Button
									>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										class={iconBtn}
										data-move="down"
										aria-label="„{f.label}“ nach unten"
										disabled={disabled || i === fieldCount - 1}
										onclick={() => move(i, 1)}><ArrowDown /></Button
									>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										class={iconBtn}
										aria-label="„{f.label}“ duplizieren"
										disabled={disabled || atLimit}
										onclick={() => duplicate(i)}><Copy /></Button
									>
									{#if !f.locked}
										<Button
											type="button"
											variant="ghost"
											size="icon"
											class="{iconBtn} text-destructive hover:text-destructive"
											aria-label="„{f.label}“ löschen"
											{disabled}
											onclick={() => askDelete(f)}><Trash /></Button
										>
									{/if}
								</div>
							</div>
							{#if ferr && !open}
								<p role="alert" class="px-4 pb-3 text-xs text-destructive">{ferr}</p>
							{/if}
							{#if open}
								<div id="{uid}-{f.id}-panel" class="border-t p-4">
									<FieldEditor
										bind:field={() => f, (v) => (definition.fields[i] = v)}
										{disabled}
										{allowedTypes}
										error={ferr}
										keyLocked={lockedKeys.includes(f.key)}
										existingKeys={definition.fields.filter((x) => x.id !== f.id).map((x) => x.key)}
									/>
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}

			<div class="flex flex-wrap items-center gap-3">
				<FieldPalette types={specs} disabled={disabled || atLimit} onadd={add} />
				{#if atLimit}
					<p class="text-xs text-muted-foreground">
						Maximale Anzahl von {maxFields} Feldern erreicht.
					</p>
				{:else}
					<p class="text-xs text-muted-foreground tabular-nums">
						{fieldCount} / {maxFields} Felder
					</p>
				{/if}
			</div>
		</Tabs.Content>

		<Tabs.Content value="preview" class="space-y-4 pt-4">
			<p class="text-xs text-muted-foreground">
				Vorschau: Eingaben werden nicht gespeichert und nicht abgeschickt.
			</p>
			<div class="rounded-xl border bg-card p-4 sm:p-6">
				{#if definition.title}
					<h2 class="text-section">{definition.title}</h2>
				{/if}
				{#if definition.intro}
					<p class="mt-1 text-sm whitespace-pre-line text-muted-foreground">{definition.intro}</p>
				{/if}
				<div class={definition.title || definition.intro ? 'mt-5' : ''}>
					{#if fieldCount === 0}
						<p class="text-sm text-muted-foreground">Das Formular hat noch keine Felder.</p>
					{:else}
						<FormRenderer {definition} bind:values={previewValues} idPrefix="{uid}-pv" />
					{/if}
				</div>
			</div>
		</Tabs.Content>
	</Tabs.Root>

	<p class="sr-only" aria-live="polite">{announce}</p>
</div>

<FormPreviewDialog bind:open={fullscreen} {definition} />

<ConfirmDialog
	bind:open={confirmOpen}
	title={pendingDelete ? `Feld „${pendingDelete.label}“ löschen?` : 'Feld löschen?'}
	description="Das Feld wird aus dem Formular entfernt. Dies gilt erst nach dem Speichern."
	confirmLabel="Löschen"
	destructive
	onconfirm={doDelete}
/>
