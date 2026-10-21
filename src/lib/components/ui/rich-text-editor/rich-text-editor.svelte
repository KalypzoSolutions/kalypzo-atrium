<script lang="ts">
	import { onMount } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import BoldIcon from '@lucide/svelte/icons/bold';
	import ItalicIcon from '@lucide/svelte/icons/italic';
	import UnderlineIcon from '@lucide/svelte/icons/underline';
	import StrikeIcon from '@lucide/svelte/icons/strikethrough';
	import Heading2Icon from '@lucide/svelte/icons/heading-2';
	import Heading3Icon from '@lucide/svelte/icons/heading-3';
	import ListIcon from '@lucide/svelte/icons/list';
	import ListOrderedIcon from '@lucide/svelte/icons/list-ordered';
	import QuoteIcon from '@lucide/svelte/icons/quote';
	import LinkIcon from '@lucide/svelte/icons/link';
	import UnlinkIcon from '@lucide/svelte/icons/unlink';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import UndoIcon from '@lucide/svelte/icons/undo-2';
	import RedoIcon from '@lucide/svelte/icons/redo-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { cn } from '$lib/utils.js';

	let {
		value = $bindable(''),
		label = 'Nachrichtentext',
		placeholder = '',
		disabled = false,
		invalid = false,
		id,
		describedby,
		minHeight = '14rem',
		onchange,
		class: className
	}: {
		/** HTML des Textes (nur einfache Formatierung; der Server bereinigt es erneut) */
		value: string;
		/** Zugänglicher Name des Textfelds */
		label?: string;
		placeholder?: string;
		disabled?: boolean;
		invalid?: boolean;
		id?: string;
		describedby?: string;
		minHeight?: string;
		onchange?: (html: string) => void;
		class?: string;
	} = $props();

	let element = $state<HTMLDivElement | null>(null);
	let editor = $state.raw<Editor | null>(null);
	/** Zähler, der bei jeder Änderung der Auswahl/des Inhalts steigt – die Werkzeugleiste liest daraus ihre Zustände */
	let tick = $state(0);
	let linkOpen = $state(false);
	let linkUrl = $state('');

	const active = (name: string, attrs?: Record<string, unknown>) => {
		void tick;
		return editor?.isActive(name, attrs) ?? false;
	};
	const can = (fn: (e: Editor) => boolean) => {
		void tick;
		return editor ? fn(editor) : false;
	};

	onMount(() => {
		if (!element) return;
		const instance = new Editor({
			element,
			content: value,
			editable: !disabled,
			extensions: [
				StarterKit.configure({
					heading: { levels: [2, 3] },
					code: false,
					codeBlock: false,
					link: {
						openOnClick: false,
						autolink: true,
						defaultProtocol: 'https',
						protocols: ['mailto'],
						HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' }
					}
				})
			],
			editorProps: {
				attributes: {
					role: 'textbox',
					'aria-multiline': 'true',
					'aria-label': label,
					...(id ? { id } : {}),
					...(describedby ? { 'aria-describedby': describedby } : {}),
					...(invalid ? { 'aria-invalid': 'true' } : {}),
					class: 'rte-content'
				}
			},
			onUpdate: ({ editor: e }) => {
				// Leerer Editor = leerer Text (statt <p></p>)
				const html = e.isEmpty ? '' : e.getHTML();
				lastEmitted = html;
				value = html;
				onchange?.(html);
				tick++;
			},
			onSelectionUpdate: () => tick++,
			onTransaction: () => tick++
		});
		editor = instance;
		return () => {
			instance.destroy();
			editor = null;
		};
	});

	// Von außen geänderter Wert (z. B. Zurücksetzen nach dem Senden) in den Editor übernehmen
	let lastEmitted = '';
	$effect(() => {
		const next = value;
		if (!editor || next === lastEmitted) return;
		lastEmitted = next;
		editor.commands.setContent(next, { emitUpdate: false });
	});

	$effect(() => {
		editor?.setEditable(!disabled);
	});

	function openLink() {
		if (!editor) return;
		linkUrl = (editor.getAttributes('link').href as string | undefined) ?? '';
		linkOpen = true;
	}

	function applyLink() {
		if (!editor) return;
		const url = linkUrl.trim();
		if (!url) {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
		} else {
			editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
		}
		linkOpen = false;
	}

	type Tool = {
		label: string;
		icon: typeof BoldIcon;
		run: (e: Editor) => void;
		isActive?: () => boolean;
		enabled?: () => boolean;
	};

	const groups: Tool[][] = $derived([
		[
			{
				label: 'Fett',
				icon: BoldIcon,
				run: (e) => e.chain().focus().toggleBold().run(),
				isActive: () => active('bold')
			},
			{
				label: 'Kursiv',
				icon: ItalicIcon,
				run: (e) => e.chain().focus().toggleItalic().run(),
				isActive: () => active('italic')
			},
			{
				label: 'Unterstrichen',
				icon: UnderlineIcon,
				run: (e) => e.chain().focus().toggleUnderline().run(),
				isActive: () => active('underline')
			},
			{
				label: 'Durchgestrichen',
				icon: StrikeIcon,
				run: (e) => e.chain().focus().toggleStrike().run(),
				isActive: () => active('strike')
			}
		],
		[
			{
				label: 'Überschrift',
				icon: Heading2Icon,
				run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
				isActive: () => active('heading', { level: 2 })
			},
			{
				label: 'Zwischenüberschrift',
				icon: Heading3Icon,
				run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
				isActive: () => active('heading', { level: 3 })
			}
		],
		[
			{
				label: 'Aufzählung',
				icon: ListIcon,
				run: (e) => e.chain().focus().toggleBulletList().run(),
				isActive: () => active('bulletList')
			},
			{
				label: 'Nummerierte Liste',
				icon: ListOrderedIcon,
				run: (e) => e.chain().focus().toggleOrderedList().run(),
				isActive: () => active('orderedList')
			},
			{
				label: 'Zitat',
				icon: QuoteIcon,
				run: (e) => e.chain().focus().toggleBlockquote().run(),
				isActive: () => active('blockquote')
			},
			{
				label: 'Trennlinie',
				icon: MinusIcon,
				run: (e) => e.chain().focus().setHorizontalRule().run()
			}
		],
		[
			{
				label: 'Link einfügen oder ändern',
				icon: LinkIcon,
				run: () => openLink(),
				isActive: () => active('link')
			},
			{
				label: 'Link entfernen',
				icon: UnlinkIcon,
				run: (e) => e.chain().focus().unsetLink().run(),
				enabled: () => active('link')
			}
		],
		[
			{
				label: 'Rückgängig',
				icon: UndoIcon,
				run: (e) => e.chain().focus().undo().run(),
				enabled: () => can((e) => e.can().undo())
			},
			{
				label: 'Wiederholen',
				icon: RedoIcon,
				run: (e) => e.chain().focus().redo().run(),
				enabled: () => can((e) => e.can().redo())
			}
		]
	]);
</script>

<div
	class={cn(
		'rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring',
		invalid && 'border-destructive',
		disabled && 'opacity-70',
		className
	)}
>
	<div
		class="flex flex-wrap items-center gap-x-1 gap-y-1 border-b p-1"
		role="toolbar"
		aria-label="Formatierung"
	>
		{#each groups as group, gi (gi)}
			{#if gi > 0}<span class="mx-0.5 h-5 w-px bg-border" aria-hidden="true"></span>{/if}
			{#each group as tool (tool.label)}
				{@const on = tool.isActive?.() ?? false}
				<Button
					type="button"
					variant={on ? 'secondary' : 'ghost'}
					size="icon-sm"
					aria-label={tool.label}
					title={tool.label}
					aria-pressed={tool.isActive ? on : undefined}
					disabled={disabled || !editor || (tool.enabled ? !tool.enabled() : false)}
					onclick={() => editor && tool.run(editor)}
				>
					<tool.icon class="size-4" />
				</Button>
			{/each}
		{/each}
	</div>
	{#if linkOpen}
		<form
			class="flex flex-wrap items-center gap-2 border-b bg-muted/40 p-2"
			onsubmit={(e) => {
				e.preventDefault();
				applyLink();
			}}
		>
			<label class="text-sm" for="{id ?? 'rte'}-link">Adresse</label>
			<Input
				id="{id ?? 'rte'}-link"
				class="h-8 min-w-48 flex-1"
				placeholder="https://… oder mailto:…"
				bind:value={linkUrl}
				autocomplete="off"
			/>
			<Button type="submit" size="sm">Übernehmen</Button>
			<Button type="button" size="sm" variant="outline" onclick={() => (linkOpen = false)}>
				Abbrechen
			</Button>
		</form>
	{/if}
	<div class="relative">
		{#if placeholder && !value}
			<p class="pointer-events-none absolute top-2 left-3 text-sm text-muted-foreground">
				{placeholder}
			</p>
		{/if}
		<div bind:this={element} class="rte" style:min-height={minHeight}></div>
	</div>
</div>

<style>
	.rte :global(.rte-content) {
		min-height: inherit;
		padding: 0.5rem 0.75rem;
		outline: none;
		font-size: 0.9rem;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}
	.rte :global(.rte-content > * + *) {
		margin-top: 0.6rem;
	}
	.rte :global(.rte-content h2) {
		font-size: 1.2rem;
		font-weight: 600;
	}
	.rte :global(.rte-content h3) {
		font-size: 1.05rem;
		font-weight: 600;
	}
	.rte :global(.rte-content ul) {
		list-style: disc;
		padding-left: 1.4rem;
	}
	.rte :global(.rte-content ol) {
		list-style: decimal;
		padding-left: 1.4rem;
	}
	.rte :global(.rte-content blockquote) {
		border-left: 3px solid var(--border);
		padding-left: 0.75rem;
		color: var(--muted-foreground);
	}
	.rte :global(.rte-content hr) {
		border: 0;
		border-top: 1px solid var(--border);
	}
	.rte :global(.rte-content a) {
		color: var(--link);
		text-decoration: underline;
	}
</style>
