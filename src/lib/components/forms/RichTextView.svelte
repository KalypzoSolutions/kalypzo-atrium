<script lang="ts">
	/**
	 * Zeigt formatierten Text (HTML aus dem `RichTextEditor`) sicher an: über `parseRichText` (Allowlist)
	 * als Svelte-Elemente statt `{@html}`, auch beim Server-Rendering.
	 */
	import { parseRichText, type RichNode } from '$lib/forms/rich-text';
	import { cn } from '$lib/utils';

	let { html, class: className }: { html: string; class?: string } = $props();

	const nodes = $derived(parseRichText(html));
</script>

{#snippet render(list: RichNode[])}
	{#each list as n, i (i)}
		{#if n.type === 'text'}{n.text}{:else if n.tag === 'br'}<br />{:else if n.tag === 'hr'}<hr
			/>{:else if n.tag === 'a'}<a
				href={n.href}
				target="_blank"
				rel="noopener noreferrer nofollow"
				class="text-link underline">{@render render(n.children)}</a
			>{:else}<svelte:element this={n.tag}>{@render render(n.children)}</svelte:element>{/if}
	{/each}
{/snippet}

<div class={cn('rich-text text-sm', className)}>{@render render(nodes)}</div>

<style>
	.rich-text :global(p) {
		margin-block: 0.5em;
	}
	.rich-text :global(h2) {
		font-size: 1.125rem;
		font-weight: 600;
		margin-block: 0.75em 0.35em;
	}
	.rich-text :global(h3) {
		font-size: 1rem;
		font-weight: 600;
		margin-block: 0.75em 0.35em;
	}
	.rich-text :global(ul) {
		list-style: disc;
		padding-inline-start: 1.25rem;
		margin-block: 0.5em;
	}
	.rich-text :global(ol) {
		list-style: decimal;
		padding-inline-start: 1.25rem;
		margin-block: 0.5em;
	}
	.rich-text :global(blockquote) {
		border-inline-start: 3px solid var(--border);
		padding-inline-start: 0.75rem;
		color: var(--muted-foreground);
		margin-block: 0.5em;
	}
	.rich-text :global(hr) {
		border-color: var(--border);
		margin-block: 0.75em;
	}
	.rich-text :global(strong),
	.rich-text :global(b) {
		font-weight: 600;
	}
	.rich-text > :global(:first-child) {
		margin-top: 0;
	}
	.rich-text > :global(:last-child) {
		margin-bottom: 0;
	}
</style>
