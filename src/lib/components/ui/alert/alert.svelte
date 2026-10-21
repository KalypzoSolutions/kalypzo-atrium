<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';

	export const alertVariants = tv({
		base: "grid gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4 group/alert relative w-full",
		variants: {
			variant: {
				default: 'bg-card text-card-foreground',
				destructive:
					'text-destructive bg-card *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current',
				// Statusvarianten: getönte Fläche + Statusrand, Text in Statusfarbe (Kontrast per Token-Test)
				info: 'border-info-border bg-info-muted text-info *:data-[slot=alert-description]:text-info',
				success:
					'border-success-border bg-success-muted text-success *:data-[slot=alert-description]:text-success',
				warning:
					'border-warning-border bg-warning-muted text-warning *:data-[slot=alert-description]:text-warning'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type AlertVariant = VariantProps<typeof alertVariants>['variant'];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		variant?: AlertVariant;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="alert"
	role={variant === 'info' || variant === 'success' ? 'status' : 'alert'}
	class={cn(alertVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
