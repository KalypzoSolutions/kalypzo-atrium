<script lang="ts">
	import { t } from '$lib/i18n';
	import { appliesTo, claimFieldContext, mergeIds } from '$lib/components/ui/field/context';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { cn } from '$lib/utils.js';
	import {
		DEFAULT_MAX_TAG_LENGTH,
		DEFAULT_MAX_TAGS,
		addTags,
		hasTag,
		normalizeTag,
		tagKey
	} from './tags.js';

	type Option = { kind: 'tag' | 'create'; value: string };

	let {
		value = $bindable([]),
		suggestions,
		loadSuggestions,
		label,
		placeholder = t('ui.tagInput.placeholder'),
		max = DEFAULT_MAX_TAGS,
		maxLength = DEFAULT_MAX_TAG_LENGTH,
		disabled = false,
		id,
		invalid = false,
		describedby,
		onchange,
		class: className
	}: {
		value: string[];
		suggestions?: string[];
		loadSuggestions?: (q: string) => Promise<string[]>;
		label?: string;
		placeholder?: string;
		max?: number;
		maxLength?: number;
		disabled?: boolean;
		id?: string;
		invalid?: boolean;
		describedby?: string;
		onchange?: (value: string[]) => void;
		class?: string;
	} = $props();

	// Hinweis/Fehler des umgebenden FormField (#51)
	const field = claimFieldContext();
	const fieldOwn = $derived(appliesTo(field, id) ? field : null);
	const isInvalid = $derived(invalid || !!fieldOwn?.invalid);

	const uid = $props.id();
	const inputId = $derived(id ?? `${uid}-input`);
	const listId = `${uid}-list`;
	const hintId = `${uid}-hint`;
	const MAX_OPTIONS = 8;
	const DEBOUNCE_MS = 200;

	let query = $state('');
	let open = $state(false);
	let active = $state(-1);
	let loaded = $state<string[]>([]);
	let inputEl: HTMLInputElement | null = $state(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let requestNo = 0;

	const full = $derived(value.length >= max);
	const inputDisabled = $derived(disabled || full);

	const fold = (s: string) =>
		s.toLocaleLowerCase('de').replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '');

	const pending = $derived(normalizeTag(query, maxLength));

	const options = $derived.by<Option[]>(() => {
		const source = loadSuggestions ? loaded : (suggestions ?? []);
		const q = fold(pending);
		const seen = new Set<string>();
		const out: Option[] = [];
		for (const s of source) {
			const tag = normalizeTag(s, maxLength);
			if (!tag || hasTag(value, tag) || seen.has(tagKey(tag))) continue;
			if (q && !fold(tag).includes(q)) continue;
			seen.add(tagKey(tag));
			out.push({ kind: 'tag', value: tag });
			if (out.length >= MAX_OPTIONS) break;
		}
		if (pending && !hasTag(value, pending) && !seen.has(tagKey(pending))) {
			out.push({ kind: 'create', value: pending });
		}
		return out;
	});
	const expanded = $derived(open && !inputDisabled && options.length > 0);
	const activeOption = $derived(expanded && active >= 0 ? options[active] : undefined);

	function optionId(i: number) {
		return `${uid}-opt-${i}`;
	}

	function commit(next: string[]) {
		if (next === value) return;
		value = next;
		onchange?.(next);
	}

	function add(raws: string[]) {
		commit(addTags(value, raws, { max, maxLength }));
	}

	function remove(index: number) {
		commit(value.filter((_, i) => i !== index));
		// Nach Entfernen bleibt der Fokus im Feld (sonst verliert man ihn mit dem Button)
		queueMicrotask(() => inputEl?.focus());
	}

	function resetQuery() {
		query = '';
		active = -1;
		scheduleLoad('');
	}

	function scheduleLoad(q: string) {
		if (!loadSuggestions) return;
		clearTimeout(timer);
		const no = ++requestNo;
		const fn = loadSuggestions;
		timer = setTimeout(async () => {
			try {
				const result = await fn(normalizeTag(q, maxLength));
				if (no === requestNo) loaded = Array.isArray(result) ? result : [];
			} catch {
				if (no === requestNo) loaded = [];
			}
		}, DEBOUNCE_MS);
	}

	$effect(() => () => clearTimeout(timer));

	function onInput() {
		if (query.includes(',')) {
			// Komma (auch beim Einfügen) trennt Tags; der Rest nach dem letzten Komma bleibt im Feld
			const parts = query.split(',');
			const rest = parts.pop() ?? '';
			add(parts);
			query = value.length >= max ? '' : rest;
		}
		active = -1;
		open = true;
		scheduleLoad(query);
	}

	function choose(option: Option) {
		add([option.value]);
		resetQuery();
	}

	function onKeydown(e: KeyboardEvent) {
		const n = options.length;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			open = true;
			if (n) active = (active + 1) % n;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			open = true;
			if (n) active = active <= 0 ? n - 1 : active - 1;
		} else if (e.key === 'Enter') {
			if (activeOption) {
				e.preventDefault();
				choose(activeOption);
			} else if (pending) {
				e.preventDefault();
				add([pending]);
				resetQuery();
			}
		} else if (e.key === 'Escape') {
			if (expanded) {
				e.preventDefault();
				e.stopPropagation(); // Dialog nicht mitschließen
				open = false;
				active = -1;
			}
		} else if (e.key === 'Backspace' && query === '' && value.length > 0) {
			e.preventDefault();
			commit(value.slice(0, -1));
		}
	}

	function onBlur() {
		open = false;
		active = -1;
		if (pending) {
			add([pending]);
			query = '';
		}
	}
</script>

<div class={cn('relative w-full min-w-0', className)} data-slot="tag-input">
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class={cn(
			'border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring flex min-h-8 w-full min-w-0 cursor-text flex-wrap items-center gap-1 rounded-lg border bg-transparent px-1.5 py-1 text-sm transition-colors focus-within:ring-3',
			isInvalid &&
				'border-destructive ring-destructive/20 dark:ring-destructive/40 dark:border-destructive/50 ring-3',
			disabled && 'cursor-not-allowed opacity-50'
		)}
		onclick={(e) => {
			if (e.target === e.currentTarget) inputEl?.focus();
		}}
	>
		{#each value as tag, i (tagKey(tag))}
			<Badge variant="secondary" class="h-6 max-w-full gap-0.5 rounded-md pr-0.5 pl-2 font-normal">
				<span class="truncate">{tag}</span>
				<button
					type="button"
					{disabled}
					aria-label={t('ui.tagInput.remove', { tag })}
					class="hover:bg-foreground/10 focus-visible:ring-ring inline-flex size-5 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 disabled:pointer-events-none [@media(pointer:coarse)]:size-7"
					onclick={() => remove(i)}
				>
					<XIcon class="size-3" />
				</button>
			</Badge>
		{/each}
		<input
			bind:this={inputEl}
			id={inputId}
			type="text"
			role="combobox"
			aria-label={label}
			aria-expanded={expanded}
			aria-controls={listId}
			aria-autocomplete="list"
			aria-haspopup="listbox"
			aria-activedescendant={activeOption ? optionId(active) : undefined}
			aria-invalid={isInvalid ? 'true' : undefined}
			aria-describedby={mergeIds(describedby, fieldOwn?.describedby, full && hintId)}
			aria-required={fieldOwn?.required || undefined}
			autocomplete="off"
			enterkeyhint="enter"
			disabled={inputDisabled}
			placeholder={full ? '' : value.length === 0 ? placeholder : ''}
			bind:value={query}
			oninput={onInput}
			onkeydown={onKeydown}
			onfocus={() => {
				open = true;
				if (loadSuggestions && loaded.length === 0) scheduleLoad(query);
			}}
			onblur={onBlur}
			class="placeholder:text-muted-foreground h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none disabled:cursor-not-allowed [@media(pointer:coarse)]:h-8"
		/>
	</div>
	{#if full && !disabled}
		<p id={hintId} class="text-muted-foreground mt-1 text-xs" aria-live="polite">
			{t('ui.tagInput.max', { max })}
		</p>
	{/if}
	<div
		id={listId}
		role="listbox"
		aria-label={label ? t('ui.tagInput.suggestionsFor', { label }) : t('ui.tagInput.suggestions')}
		hidden={!expanded}
		class="bg-popover text-popover-foreground ring-foreground/10 absolute top-full left-0 z-50 mt-1 max-h-64 w-full min-w-48 overflow-y-auto rounded-lg p-1 shadow-md ring-1"
	>
		{#if expanded}
			{#each options as o, i (o.kind + ':' + tagKey(o.value))}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					id={optionId(i)}
					role="option"
					aria-selected={i === active}
					tabindex="-1"
					class={cn(
						'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm select-none [@media(pointer:coarse)]:py-2.5',
						i === active && 'bg-accent text-accent-foreground'
					)}
					onpointermove={() => (active = i)}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => choose(o)}
				>
					{#if o.kind === 'create'}
						<PlusIcon class="text-muted-foreground size-4 shrink-0" />
						<span class="min-w-0 truncate">{t('ui.tagInput.create', { tag: o.value })}</span>
					{:else}
						<span class="min-w-0 truncate">{o.value}</span>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>
