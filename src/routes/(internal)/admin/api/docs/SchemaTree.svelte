<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { SvelteSet } from 'svelte/reactivity';
	import { Badge } from '$lib/components/ui/badge';
	import type { JsonSchema } from '$lib/api-docs/types';
	import { t } from '$lib/i18n';

	let { schema, emptyText }: { schema: JsonSchema; emptyText?: string } = $props();

	const uid = $props.id();
	const MAX_DEPTH = 8;
	/** Ab dieser Tiefe sind verschachtelte Inhalte auf-/zuklappbar (Standard: zu) */
	const COLLAPSE_FROM = 2;

	/** Normalisiertes Schema: allOf zusammengeführt, null-Varianten als `nullable`, Varianten ≥ 2 */
	interface Norm {
		s: JsonSchema;
		nullable: boolean;
		variants: JsonSchema[];
	}

	interface Constraint {
		label: string;
		title?: string;
	}

	const expanded = new SvelteSet<string>();

	function isObj(v: unknown): v is JsonSchema {
		return typeof v === 'object' && v !== null && !Array.isArray(v);
	}

	function mergeSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
		const out: JsonSchema = { ...a, ...b };
		if (a.properties || b.properties) {
			const props: Record<string, JsonSchema> = { ...(a.properties ?? {}) };
			for (const [k, v] of Object.entries(b.properties ?? {})) {
				const prev = props[k];
				props[k] = prev && isObj(prev) && isObj(v) ? mergeSchemas(prev, v) : v;
			}
			out.properties = props;
		}
		if (a.required || b.required) {
			out.required = [...new Set([...(a.required ?? []), ...(b.required ?? [])])];
		}
		if (a.description && !b.description) out.description = a.description;
		return out;
	}

	function flattenAllOf(s: JsonSchema, guard = 0): JsonSchema {
		if (!Array.isArray(s.allOf) || guard > MAX_DEPTH) return s;
		const { allOf, ...rest } = s;
		let merged: JsonSchema = {};
		for (const part of allOf) {
			if (isObj(part)) merged = mergeSchemas(merged, flattenAllOf(part, guard + 1));
		}
		return mergeSchemas(merged, rest);
	}

	function isNullSchema(s: unknown): boolean {
		return (
			isObj(s) &&
			(s.type === 'null' || (Array.isArray(s.type) && s.type.every((t) => t === 'null')))
		);
	}

	function norm(input: unknown, guard = 0): Norm {
		if (!isObj(input)) return { s: {}, nullable: false, variants: [] };
		let s = flattenAllOf(input);
		let nullable = s.nullable === true;
		if (Array.isArray(s.type)) {
			if (s.type.includes('null')) nullable = true;
			const types = s.type.filter((t) => t !== 'null');
			s = { ...s, type: types.length === 1 ? types[0] : types.length ? types : undefined };
		}
		const raw = [
			...(Array.isArray(s.anyOf) ? s.anyOf : []),
			...(Array.isArray(s.oneOf) ? s.oneOf : [])
		];
		let variants: JsonSchema[] = [];
		if (raw.length) {
			if (raw.some(isNullSchema)) nullable = true;
			variants = raw.filter((v) => isObj(v) && !isNullSchema(v));
			const rest: JsonSchema = { ...s };
			delete rest.anyOf;
			delete rest.oneOf;
			if (variants.length === 1 && guard < MAX_DEPTH) {
				const inner = norm(variants[0], guard + 1);
				return {
					s: mergeSchemas(inner.s, stripEmpty(rest)),
					nullable: nullable || inner.nullable,
					variants: inner.variants
				};
			}
			s = rest;
		}
		return { s, nullable, variants };
	}

	function stripEmpty(s: JsonSchema): JsonSchema {
		const out: JsonSchema = {};
		for (const [k, v] of Object.entries(s)) if (v !== undefined) out[k] = v;
		return out;
	}

	function truncate(text: string, max: number): string {
		return text.length > max ? `${text.slice(0, max - 1)}…` : text;
	}

	function fmt(v: unknown): string {
		let text: string;
		try {
			text = JSON.stringify(v) ?? String(v);
		} catch {
			text = String(v);
		}
		return truncate(text, 40);
	}

	function typeList(s: JsonSchema): string[] {
		if (Array.isArray(s.type)) return s.type.filter((t): t is string => typeof t === 'string');
		if (typeof s.type === 'string') return [s.type];
		if (s.properties) return ['object'];
		if (s.items) return ['array'];
		return [];
	}

	function typeLabel(n: Norm, guard = 0): string {
		const { s } = n;
		let label: string;
		if (guard > 3) label = '…';
		else if (s.const !== undefined) label = fmt(s.const);
		else if (Array.isArray(s.enum) && s.enum.length) {
			const shown = s.enum.slice(0, 6).map(fmt);
			if (s.enum.length > 6) shown.push('…');
			label = shown.join(' | ');
			if (s.enum.includes(null)) return label;
		} else if (n.variants.length) {
			label = n.variants.map((v) => typeLabel(norm(v), guard + 1)).join(' | ');
		} else {
			const types = typeList(s);
			label = types.length
				? types
						.map((ty) =>
							ty === 'array'
								? `array<${s.items ? typeLabel(norm(s.items), guard + 1) : t('api-docs.schema.any')}>`
								: ty
						)
						.join(' | ')
				: t('api-docs.schema.any');
		}
		return n.nullable ? `${label} | null` : label;
	}

	function range(min: number | undefined, max: number | undefined): string | null {
		if (min !== undefined && max !== undefined) return min === max ? `${min}` : `${min}–${max}`;
		if (min !== undefined) return `min. ${min}`;
		if (max !== undefined) return `max. ${max}`;
		return null;
	}

	function num(v: unknown): number | undefined {
		return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
	}

	function constraints(s: JsonSchema, withItems = true): Constraint[] {
		const out: Constraint[] = [];
		if (s.format) out.push({ label: t('api-docs.schema.format', { value: String(s.format) }) });
		const len = range(num(s.minLength), num(s.maxLength));
		if (len) out.push({ label: t('api-docs.schema.length', { value: len }) });
		const min = num(s.minimum);
		const max = num(s.maximum);
		const exMin = num(s.exclusiveMinimum);
		const exMax = num(s.exclusiveMaximum);
		if (min !== undefined && max !== undefined)
			out.push({ label: t('api-docs.schema.value', { min, max }) });
		else if (min !== undefined) out.push({ label: `≥ ${min}` });
		else if (max !== undefined) out.push({ label: `≤ ${max}` });
		if (exMin !== undefined) out.push({ label: `> ${exMin}` });
		if (exMax !== undefined) out.push({ label: `< ${exMax}` });
		const items = range(num(s.minItems), num(s.maxItems));
		if (items) out.push({ label: t('api-docs.schema.items', { value: items }) });
		if (typeof s.pattern === 'string' && s.pattern) {
			out.push({
				label: t('api-docs.schema.pattern', { value: truncate(s.pattern, 24) }),
				title: s.pattern
			});
		}
		if (s.default !== undefined)
			out.push({ label: t('api-docs.schema.default', { value: fmt(s.default) }) });
		if (withItems && s.items && !hasNested(norm(s.items))) {
			for (const c of constraints(norm(s.items).s, false)) {
				out.push({ label: t('api-docs.schema.element', { label: c.label }), title: c.title });
			}
		}
		return out;
	}

	function additional(s: JsonSchema): JsonSchema | null {
		return isObj(s.additionalProperties) ? s.additionalProperties : null;
	}

	function hasNested(n: Norm, guard = 0): boolean {
		if (guard > MAX_DEPTH) return false;
		if (n.variants.length) return true;
		if (n.s.properties && Object.keys(n.s.properties).length) return true;
		if (additional(n.s)) return true;
		if (n.s.items) return hasNested(norm(n.s.items), guard + 1);
		return false;
	}

	function describe(s: JsonSchema): string | null {
		const d = typeof s.description === 'string' ? s.description : null;
		return d || (typeof s.title === 'string' ? s.title : null) || null;
	}

	function domId(path: string): string {
		return `${uid}-schema-${path}`;
	}

	function toggle(path: string) {
		if (expanded.has(path)) expanded.delete(path);
		else expanded.add(path);
	}

	const root = $derived(norm(schema));
	const rootProps = $derived(Object.entries(root.s.properties ?? {}));
	const rootIsObject = $derived(
		root.variants.length === 0 && (rootProps.length > 0 || typeList(root.s).includes('object'))
	);
	const isEmpty = $derived(
		!isObj(schema) ||
			Object.keys(schema).length === 0 ||
			(rootIsObject && rootProps.length === 0 && !additional(root.s))
	);
</script>

{#snippet constraintList(list: Constraint[])}
	{#each list as c, i (i)}
		<span class="text-xs break-all text-muted-foreground" title={c.title}>{c.label}</span>
	{/each}
{/snippet}

{#snippet field(
	name: string,
	raw: JsonSchema,
	required: boolean | null,
	depth: number,
	path: string
)}
	{@const n = norm(raw)}
	{@const nested = hasNested(n) && depth < MAX_DEPTH}
	{@const collapsible = nested && depth + 1 >= COLLAPSE_FROM}
	{@const open = !collapsible || expanded.has(path)}
	{@const desc = describe(n.s)}
	<li class="py-1.5">
		<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
			{#if collapsible}
				<button
					type="button"
					class="inline-flex size-5 shrink-0 items-center justify-center self-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					aria-expanded={open}
					aria-controls={domId(path)}
					aria-label={open
						? t('api-docs.schema.collapse', { name })
						: t('api-docs.schema.expand', { name })}
					onclick={() => toggle(path)}
				>
					<ChevronRight class="size-4 transition-transform {open ? 'rotate-90' : ''}" />
				</button>
			{/if}
			<span class="font-mono text-sm font-medium break-all text-foreground">{name}</span>
			<span class="rounded bg-muted px-1 font-mono text-xs break-all text-foreground/80"
				>{typeLabel(n)}</span
			>
			{#if required === true}
				<Badge variant="secondary">{t('api-docs.schema.required')}</Badge>
			{:else if required === false}
				<span class="text-xs text-muted-foreground">{t('api-docs.schema.optional')}</span>
			{/if}
			{@render constraintList(constraints(n.s))}
		</div>
		{#if desc}
			<p class="mt-0.5 text-xs break-words text-muted-foreground">{desc}</p>
		{/if}
		{#if hasNested(n) && depth >= MAX_DEPTH}
			<p class="mt-0.5 text-xs text-muted-foreground italic">{t('api-docs.schema.maxDepth')}</p>
		{:else if nested && open}
			<div id={domId(path)} class="mt-1 ml-2 border-l border-border pl-3">
				{@render children(n, depth + 1, path)}
			</div>
		{/if}
	</li>
{/snippet}

{#snippet fieldList(s: JsonSchema, depth: number, path: string)}
	{@const req = new Set(s.required ?? [])}
	{@const extra = additional(s)}
	<ul class="divide-y divide-border/60">
		{#each Object.entries(s.properties ?? {}) as [name, prop], i (name)}
			{@render field(name, prop, req.has(name), depth, `${path}-${i}`)}
		{/each}
		{#if extra}
			{@render field(t('api-docs.schema.moreKeys'), extra, null, depth, `${path}-x`)}
		{/if}
	</ul>
{/snippet}

{#snippet children(n: Norm, depth: number, path: string)}
	{#if n.variants.length}
		<p class="pt-1 text-xs font-medium text-muted-foreground">{t('api-docs.schema.oneOf')}</p>
		<ul>
			{#each n.variants as variant, i (i)}
				{@render field(
					t('api-docs.schema.variant', { n: i + 1 }),
					variant,
					null,
					depth,
					`${path}-v${i}`
				)}
			{/each}
		</ul>
	{:else if (n.s.properties && Object.keys(n.s.properties).length) || additional(n.s)}
		{@render fieldList(n.s, depth, path)}
	{:else if n.s.items}
		{@const item = norm(n.s.items)}
		<p class="pt-1 text-xs font-medium text-muted-foreground">
			{t('api-docs.schema.elements')} <span class="font-mono">{typeLabel(item)}</span>
		</p>
		{@render children(item, depth, `${path}-i`)}
	{/if}
{/snippet}

<div class="min-w-0 text-sm">
	{#if isEmpty}
		<p class="text-sm text-muted-foreground">{emptyText ?? t('api-docs.schema.noFields')}</p>
	{:else if rootIsObject}
		{@const desc = describe(root.s)}
		{#if desc}
			<p class="mb-1 text-xs break-words text-muted-foreground">{desc}</p>
		{/if}
		{@render fieldList(root.s, 0, 'r')}
	{:else}
		{@const desc = describe(root.s)}
		<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
			<span class="rounded bg-muted px-1 font-mono text-xs break-all text-foreground/80"
				>{typeLabel(root)}</span
			>
			{@render constraintList(constraints(root.s))}
		</div>
		{#if desc}
			<p class="mt-0.5 text-xs break-words text-muted-foreground">{desc}</p>
		{/if}
		{#if hasNested(root)}
			<div class="mt-1 ml-2 border-l border-border pl-3">
				{@render children(root, 1, 'r')}
			</div>
		{/if}
	{/if}
</div>
