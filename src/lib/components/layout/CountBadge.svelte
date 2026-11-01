<script lang="ts">
	import { t } from '$lib/i18n';
	import { cn } from '$lib/utils';
	import { formatCount } from './count';

	/**
	 * Runder Zähler (z. B. ungelesene Mails): Kreis bei einstelligen Zahlen, ab `max + 1` „9+“.
	 * Bei 0 wird nichts angezeigt. `label` ist der zugängliche Name („3 ungelesen“).
	 */
	let {
		count,
		max = 9,
		label,
		variant = 'primary',
		class: className
	}: {
		count: number;
		max?: number;
		/** Zugänglicher Name; Standard „<Zahl> ungelesen“ */
		label?: string;
		variant?: 'primary' | 'info';
		class?: string;
	} = $props();

	const text = $derived(formatCount(count, max));
</script>

{#if text}
	<span
		class={cn(
			'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-xs leading-none font-semibold tabular-nums',
			variant === 'primary'
				? 'bg-primary text-primary-foreground'
				: 'border border-info-border bg-info-muted text-info',
			className
		)}
		title={label ?? t('layout.unread', { count: Math.floor(count) })}
	>
		<span aria-hidden="true">{text}</span>
		<span class="sr-only">({label ?? t('layout.unread', { count: Math.floor(count) })})</span>
	</span>
{/if}
