<script lang="ts">
	import { t } from '$lib/i18n';
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle
	} from '$lib/components/ui/alert-dialog';

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel = t('layout.confirm'),
		cancelLabel = t('layout.cancel'),
		destructive = false,
		onconfirm
	}: {
		open?: boolean;
		title: string;
		description?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		destructive?: boolean;
		onconfirm: () => void | Promise<void>;
	} = $props();

	/** Schließt immer selbst (auch wenn der Dialog in einem anderen Dialog liegt), dann die Aktion. */
	async function confirm() {
		open = false;
		await onconfirm();
	}
</script>

<AlertDialog bind:open>
	<AlertDialogContent>
		<AlertDialogHeader>
			<AlertDialogTitle>{title}</AlertDialogTitle>
			{#if description}<AlertDialogDescription>{description}</AlertDialogDescription>{/if}
		</AlertDialogHeader>
		<AlertDialogFooter>
			<AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
			<AlertDialogAction variant={destructive ? 'destructive-solid' : 'default'} onclick={confirm}>
				{confirmLabel}
			</AlertDialogAction>
		</AlertDialogFooter>
	</AlertDialogContent>
</AlertDialog>
