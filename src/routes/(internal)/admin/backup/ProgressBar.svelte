<script lang="ts">
	let {
		value,
		label,
		indeterminate = false
	}: {
		/** 0–100 */
		value: number;
		/** Zugänglicher Name */
		label: string;
		indeterminate?: boolean;
	} = $props();

	const pct = $derived(Math.min(100, Math.max(0, Math.round(value))));
</script>

<div
	class="h-2 w-full overflow-hidden rounded-full bg-muted"
	role="progressbar"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={100}
	aria-valuenow={indeterminate ? undefined : pct}
>
	{#if indeterminate}
		<div class="h-full w-1/3 animate-pulse rounded-full bg-primary"></div>
	{:else}
		<div
			class="h-full rounded-full bg-primary transition-[width] duration-300"
			style:width="{pct}%"
		></div>
	{/if}
</div>
