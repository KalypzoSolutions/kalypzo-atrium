<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import { Input } from '$lib/components/ui/input';

	let {
		param = 'search',
		placeholder = 'Suchen ...',
		label = 'Suche',
		resetParams = ['offset']
	}: {
		param?: string;
		placeholder?: string;
		label?: string;
		/** URL-Parameter, die bei geaenderter Suche entfernt werden (z. B. Seite/Offset) */
		resetParams?: string[];
	} = $props();

	let value = $state(untrack(() => page.url.searchParams.get(param) ?? ''));
	let timer: ReturnType<typeof setTimeout> | undefined;

	function update() {
		clearTimeout(timer);
		timer = setTimeout(() => {
			const url = new URL(page.url);
			if (value.trim()) url.searchParams.set(param, value.trim());
			else url.searchParams.delete(param);
			for (const r of resetParams) url.searchParams.delete(r);
			goto(url, { keepFocus: true, replaceState: true, noScroll: true });
		}, 300);
	}
</script>

<div class="relative w-full max-w-sm">
	<Search
		class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
		aria-hidden="true"
	/>
	<Input type="search" class="pl-8" aria-label={label} {placeholder} bind:value oninput={update} />
</div>
