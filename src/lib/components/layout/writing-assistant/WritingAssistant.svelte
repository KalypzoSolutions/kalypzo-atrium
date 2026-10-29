<script lang="ts">
	// Blatt der KI-Schreibhilfe: Aufgabe wählen, Vorschlag erzeugen (gestreamt), Änderungen ansehen,
	// übernehmen oder verwerfen. Desktop/Tablet als Seitenblatt rechts, Handy als Blatt von unten.
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import CheckIcon from '@lucide/svelte/icons/check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import BottomSheet from '../BottomSheet.svelte';
	import { deviceLayout } from '../viewport.svelte';
	import { cn } from '$lib/utils.js';
	import { ApiClientError } from '$lib/sdk/client';
	import { requestAssist } from '$lib/sdk/client/assist';
	import {
		ASSIST_LIST_TASKS,
		ASSIST_TASK_LABELS,
		ASSIST_VARIANT_TASKS,
		type AssistAddress,
		type AssistPurposeInfo,
		type AssistResult,
		type AssistTask
	} from '$lib/sdk/types/assist';
	import { extraValues, type AssistConfig } from './assist.svelte';
	import { textOfHtml, wordDiff } from './diff';

	let {
		open = $bindable(false),
		config,
		info,
		address: defaultAddress = 'du',
		allowImages = false,
		compare = true,
		applyLabel = 'Übernehmen',
		notice,
		text,
		tasks: onlyTasks,
		onapply,
		onitems
	}: {
		open?: boolean;
		config: AssistConfig;
		info: AssistPurposeInfo;
		address?: AssistAddress;
		/** Bilder dürfen an die KI (Einstellung) – sonst keine Bildbeschreibung */
		allowImages?: boolean;
		/** Änderungen gegenüber dem Text zeigen (aus bei „einfügen“, z. B. Zusammenfassung einer Notiz) */
		compare?: boolean;
		/** Beschriftung des Übernehmen-Knopfs, z. B. „Einfügen“ */
		applyLabel?: string;
		/** Hinweis oben im Blatt */
		notice?: string;
		/** Aktueller Inhalt des Feldes */
		text: string;
		/** Nur diese Aufgaben anbieten (z. B. nur Betreff am Betreff-Feld) */
		tasks?: AssistTask[];
		/** Text oder gewählte Variante übernehmen */
		onapply: (value: string) => void;
		/** Einträge übernehmen (Unteraufgaben, Packliste) */
		onitems?: (items: string[]) => void;
	} = $props();

	const phone = $derived(deviceLayout() === 'phone');
	const tasks = $derived(
		info.tasks.filter(
			(t) => (!onlyTasks || onlyTasks.includes(t)) && (t !== 'alt-text' || allowImages)
		)
	);
	const emptyText = $derived(
		(info.format === 'rich' ? textOfHtml(text) : text).trim().length === 0
	);

	let task = $state<AssistTask>('draft');
	let address = $state<AssistAddress>('du');
	let instruction = $state('');
	let busy = $state(false);
	let preview = $state('');
	let result = $state<AssistResult | null>(null);
	let error = $state('');
	let picked = $state<boolean[]>([]);
	let abort: AbortController | null = null;
	let wasOpen = false;

	const isVariants = $derived(ASSIST_VARIANT_TASKS.includes(task));
	const isList = $derived(ASSIST_LIST_TASKS.includes(task));
	// Bei leerem Feld nur Aufgaben, die ohne Text funktionieren
	const usable = $derived(
		tasks.filter(
			(t) =>
				!emptyText ||
				t === 'draft' ||
				t === 'packing-list' ||
				t === 'alt-text' ||
				t === 'title' ||
				t === 'subject'
		)
	);

	// Beim Öffnen zurücksetzen und eine passende Aufgabe vorwählen
	$effect(() => {
		if (open && !wasOpen) {
			result = null;
			preview = '';
			error = '';
			address = defaultAddress;
			task = usable.includes('draft') && emptyText ? 'draft' : (usable[0] ?? tasks[0] ?? 'draft');
		}
		if (!open && wasOpen) abort?.abort();
		wasOpen = open;
	});

	const original = $derived(info.format === 'rich' ? textOfHtml(text) : text);
	const suggestion = $derived(
		result
			? info.format === 'rich' && task !== 'alt-text'
				? textOfHtml(result.text)
				: result.text
			: ''
	);
	const diff = $derived(
		compare && result && !isVariants && !isList && original.trim() && task !== 'english'
			? wordDiff(original, suggestion)
			: null
	);

	async function generate() {
		abort?.abort();
		const controller = new AbortController();
		abort = controller;
		busy = true;
		error = '';
		result = null;
		preview = '';
		try {
			const res = await requestAssist(
				{
					module: config.module,
					purpose: config.purpose,
					task,
					text,
					instruction: instruction.trim() || undefined,
					address,
					context: config.context,
					extra: extraValues(config)
				},
				{
					signal: controller.signal,
					onDelta: (soFar) => (preview = info.format === 'rich' ? textOfHtml(soFar) : soFar)
				}
			);
			result = res;
			picked = (res.items ?? []).map(() => true);
		} catch (e) {
			if (controller.signal.aborted) return;
			error =
				e instanceof ApiClientError ? e.message : 'Die Schreibhilfe ist gerade nicht erreichbar';
		} finally {
			if (abort === controller) {
				busy = false;
				abort = null;
			}
		}
	}

	function apply(value: string) {
		onapply(value);
		open = false;
	}

	function applyItems() {
		const items = (result?.items ?? []).filter((_, i) => picked[i]);
		if (items.length) onitems?.(items);
		open = false;
	}

	const facts = $derived(Object.entries(result?.facts ?? {}));
	const titleText = 'Schreibhilfe';
</script>

{#snippet body()}
	<div class="space-y-5 text-sm">
		{#if !phone}<p class="text-muted-foreground">{info.label}</p>{/if}
		{#if notice}
			<Alert.Root variant="info">
				<Alert.Description>{notice}</Alert.Description>
			</Alert.Root>
		{/if}

		<fieldset class="space-y-2">
			<legend class="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				Was soll passieren?
			</legend>
			<div class="flex flex-wrap gap-2">
				{#each usable as t (t)}
					<button
						type="button"
						class={cn(
							'flex h-9 items-center rounded-full border px-3 text-sm font-medium transition-colors',
							t === task
								? 'border-link bg-link/10 font-semibold text-link'
								: 'bg-background hover:bg-muted'
						)}
						aria-pressed={t === task}
						disabled={busy}
						onclick={() => (task = t)}
					>
						{ASSIST_TASK_LABELS[t]}
					</button>
				{/each}
			</div>
			{#if emptyText && usable.length < tasks.length}
				<p class="text-xs text-muted-foreground">
					Weitere Aktionen gibt es, sobald im Feld Text steht.
				</p>
			{/if}
		</fieldset>

		{#if !isVariants && !isList && !['spelling', 'english', 'alt-text', 'summarize'].includes(task)}
			<fieldset>
				<legend class="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Anrede
				</legend>
				<div class="flex gap-2">
					{#each ['du', 'ihr', 'Sie'] as const as a (a)}
						<button
							type="button"
							class={cn(
								'flex h-9 items-center rounded-full border px-3 text-sm font-medium transition-colors',
								a === address
									? 'border-link bg-link/10 font-semibold text-link'
									: 'bg-background hover:bg-muted'
							)}
							aria-pressed={a === address}
							disabled={busy}
							onclick={() => (address = a)}
						>
							{a}
						</button>
					{/each}
				</div>
			</fieldset>
		{/if}

		<div class="space-y-1.5">
			<Label for="assist-instruction">
				{task === 'rewrite' ? 'Was soll sich ändern? *' : 'Zusätzlicher Wunsch (optional)'}
			</Label>
			<Textarea
				id="assist-instruction"
				bind:value={instruction}
				rows={2}
				maxlength={1000}
				disabled={busy}
				placeholder={task === 'draft'
					? 'z. B. „Erinnere an Schlafsack und Taschenlampe“'
					: 'z. B. „Etwas förmlicher“'}
			/>
		</div>

		<Button
			type="button"
			class="w-full"
			disabled={busy || (task === 'rewrite' && !instruction.trim())}
			onclick={generate}
		>
			<SparklesIcon class="size-4" />
			{busy ? 'Schreibt …' : result ? 'Neu erzeugen' : 'Vorschlag erzeugen'}
		</Button>

		{#if error}
			<Alert.Root variant="destructive">
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		{/if}

		{#if busy && preview}
			<section aria-live="polite" class="rounded-md border bg-muted/40 p-3">
				<p class="whitespace-pre-wrap text-muted-foreground">{preview}</p>
			</section>
		{/if}

		{#if result}
			<section class="space-y-3" aria-labelledby="assist-result-title">
				<h3
					id="assist-result-title"
					class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
				>
					Vorschlag
				</h3>
				{#if result.variants}
					<ul class="space-y-2">
						{#each result.variants as v, i (i)}
							<li>
								<button
									type="button"
									class="w-full rounded-md border bg-background p-3 text-left hover:border-link hover:bg-muted"
									onclick={() => apply(v)}
								>
									{v}
								</button>
							</li>
						{/each}
					</ul>
					<p class="text-xs text-muted-foreground">Antippen übernimmt den Vorschlag.</p>
				{:else if result.items}
					<ul class="space-y-2">
						{#each result.items as item, i (i)}
							<li class="flex items-start gap-2">
								<Checkbox id="assist-item-{i}" bind:checked={picked[i]} />
								<Label for="assist-item-{i}" class="font-normal leading-snug">{item}</Label>
							</li>
						{/each}
					</ul>
				{:else if diff}
					<p class="rounded-md border bg-background p-3 leading-relaxed whitespace-pre-wrap">
						{#each diff as part, i (i)}
							{#if part.kind === 'added'}
								<ins class="rounded-sm bg-success-muted text-success no-underline">{part.text}</ins>
							{:else if part.kind === 'removed'}
								<del class="rounded-sm bg-destructive-muted text-destructive">{part.text}</del>
							{:else}
								{part.text}
							{/if}
						{/each}
					</p>
					<p class="text-xs text-muted-foreground">Grün = neu, rot durchgestrichen = entfällt.</p>
				{:else}
					<p class="rounded-md border bg-background p-3 leading-relaxed whitespace-pre-wrap">
						{suggestion}
					</p>
				{/if}

				{#if result.checks.length}
					<ul class="space-y-1">
						{#each result.checks as check, i (i)}
							<li class="flex items-start gap-2 text-xs">
								{#if check.level === 'ok'}
									<CheckIcon class="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
								{:else}
									<TriangleAlertIcon
										class="mt-0.5 size-3.5 shrink-0 text-warning"
										aria-hidden="true"
									/>
								{/if}
								<span>{check.message}</span>
							</li>
						{/each}
					</ul>
				{/if}

				{#if facts.length}
					<details class="rounded-md border p-3 text-xs">
						<summary class="cursor-pointer font-medium">Eckdaten, die die KI bekommen hat</summary>
						<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
							{#each facts as [k, v] (k)}
								<dt class="text-muted-foreground">{k}</dt>
								<dd class="min-w-0 break-words">{v}</dd>
							{/each}
						</dl>
					</details>
				{/if}
			</section>
		{/if}
	</div>
{/snippet}

{#snippet actions()}
	<div class="flex w-full flex-col gap-2">
		{#if result && !result.variants}
			<div class="flex gap-2">
				{#if result.items}
					<Button
						type="button"
						class="flex-1"
						disabled={!picked.some(Boolean) || !onitems}
						onclick={applyItems}
					>
						{applyLabel}
					</Button>
				{:else}
					<Button type="button" class="flex-1" onclick={() => apply(result!.text)}
						>{applyLabel}</Button
					>
				{/if}
				<Button type="button" variant="outline" onclick={() => (result = null)}>Verwerfen</Button>
			</div>
		{/if}
		<p class="text-xs text-muted-foreground">Vorschlag der KI – bitte vor dem Senden lesen.</p>
	</div>
{/snippet}

{#if phone}
	<BottomSheet bind:open title={titleText} description={info.label} size="tall" footer={actions}>
		{@render body()}
	</BottomSheet>
{:else}
	<Sheet.Root bind:open>
		<Sheet.Content side="right" class="w-full gap-0 sm:max-w-md">
			<Sheet.Header class="border-b">
				<Sheet.Title class="flex items-center gap-2">
					<SparklesIcon class="size-4 text-link" aria-hidden="true" />
					{titleText}
				</Sheet.Title>
				<Sheet.Description class="sr-only">Vorschläge der KI für dieses Textfeld</Sheet.Description>
			</Sheet.Header>
			<div class="min-h-0 flex-1 overflow-y-auto p-4">
				{@render body()}
			</div>
			<Sheet.Footer class="border-t">
				{@render actions()}
			</Sheet.Footer>
		</Sheet.Content>
	</Sheet.Root>
{/if}
