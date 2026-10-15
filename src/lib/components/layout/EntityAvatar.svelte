<script lang="ts">
	import { contrastTextColor } from '$lib/components/ui/color-picker/color';

	/** Rundes Bild mit Farbrand; ohne Bild erscheinen die Initialen auf der Farbe. */
	let {
		name,
		src = null,
		color = null,
		size = 40
	}: { name: string; src?: string | null; color?: string | null; size?: number } = $props();

	let failed = $state(false);

	const initials = $derived(
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0]!.toUpperCase())
			.join('')
	);
	const ring = $derived(color ?? 'var(--border)');
	const showImage = $derived(!!src && !failed);
</script>

<span
	class="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-muted text-xs font-semibold"
	style="width:{size}px;height:{size}px;border-color:{ring};{!showImage && color
		? `background-color:${color};color:${contrastTextColor(color)}`
		: ''}"
>
	{#if showImage}
		<img {src} alt={name} class="size-full object-cover" onerror={() => (failed = true)} />
	{:else}
		<span aria-hidden="true">{initials}</span>
		<span class="sr-only">{name}</span>
	{/if}
</span>
