<script lang="ts">
	import { page } from '$app/state';
	import { cn } from '$lib/utils';
	import { iconFor } from './icons';

	/**
	 * Reiterleiste aus Links (eigene URL je Reiter, verlinkbar), Optik wie `Tabs variant="line"`.
	 * Aktiv ist der Reiter mit dem längsten passenden `href`.
	 */
	let {
		tabs,
		label
	}: {
		tabs: readonly { label: string; href: string; icon?: string }[];
		/** Zugänglicher Name der Navigation, z. B. „Einstellungsbereiche“ */
		label: string;
	} = $props();

	const activeHref = $derived(
		tabs
			.map((t) => t.href)
			.filter((h) => page.url.pathname === h || page.url.pathname.startsWith(h + '/'))
			.sort((a, b) => b.length - a.length)[0] ?? null
	);
</script>

<nav aria-label={label} class="border-b">
	<ul class="-mb-px flex flex-wrap gap-1">
		{#each tabs as t (t.href)}
			{@const active = t.href === activeHref}
			{@const Icon = t.icon ? iconFor(t.icon) : null}
			<li>
				<a
					href={t.href}
					aria-current={active ? 'page' : undefined}
					class={cn(
						'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
						active
							? 'border-primary text-foreground'
							: 'border-transparent text-muted-foreground hover:text-foreground'
					)}
				>
					{#if Icon}<Icon class="size-4 shrink-0" aria-hidden="true" />{/if}
					{t.label}
				</a>
			</li>
		{/each}
	</ul>
</nav>
