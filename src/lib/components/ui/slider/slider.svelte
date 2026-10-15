<script lang="ts">
	import { Slider as SliderPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		value = $bindable(0),
		min = 0,
		max = 100,
		step = 1,
		disabled = false,
		label,
		onchange,
		class: className
	}: {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		disabled?: boolean;
		/** Zugaengliche Bezeichnung (aria-label), Pflicht */
		label: string;
		onchange?: (value: number) => void;
		class?: string;
	} = $props();

	function change(v: number) {
		value = v;
		onchange?.(v);
	}
</script>

<SliderPrimitive.Root
	type="single"
	bind:value
	onValueChange={change}
	{min}
	{max}
	{step}
	{disabled}
	data-slot="slider"
	class={cn(
		'relative flex w-full touch-none items-center py-2 select-none data-disabled:cursor-not-allowed data-disabled:opacity-50',
		className
	)}
>
	<span
		data-slot="slider-track"
		class="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"
	>
		<SliderPrimitive.Range data-slot="slider-range" class="absolute h-full bg-primary" />
	</span>
	<SliderPrimitive.Thumb
		index={0}
		aria-label={label}
		data-slot="slider-thumb"
		class="block size-4.5 shrink-0 rounded-full border-2 border-primary bg-background shadow-sm transition-[box-shadow,transform] outline-none hover:ring-4 hover:ring-ring/30 focus-visible:ring-4 focus-visible:ring-ring/50 active:scale-110 disabled:pointer-events-none"
	/>
</SliderPrimitive.Root>
