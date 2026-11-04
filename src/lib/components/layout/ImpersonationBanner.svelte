<script lang="ts">
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import DramaIcon from '@lucide/svelte/icons/drama';
	import { Button } from '$lib/components/ui/button';
	import { t } from '$lib/i18n';

	/**
	 * Hinweisleiste über der Kopfzeile, solange eine Admin-Person „als jemand“ handelt: wer, wie lange noch, Beenden.
	 * Setzt `--impersonation-h` am `<html>`, damit vollflächige Seiten ihre Höhe darum kürzen.
	 */
	let {
		impersonation
	}: {
		impersonation: {
			admin: { id: string; name: string };
			target: { id: string; name: string };
			expiresAt: string;
		};
	} = $props();

	let now = $state(Date.now());
	const remainingMs = $derived(new Date(impersonation.expiresAt).getTime() - now);
	const minutes = $derived(Math.max(0, Math.ceil(remainingMs / 60_000)));

	const timer = setInterval(() => {
		now = Date.now();
		// Abgelaufen: Seite neu laden, der Server beendet das Handeln
		if (remainingMs <= 0) {
			clearInterval(timer);
			void invalidateAll();
		}
	}, 15_000);

	$effect(() => {
		document.documentElement.style.setProperty('--impersonation-h', '2.75rem');
		return () => document.documentElement.style.removeProperty('--impersonation-h');
	});
	onDestroy(() => clearInterval(timer));
</script>

<div
	role="status"
	class="flex h-11 shrink-0 items-center gap-3 border-b border-warning-border bg-warning-muted px-4 text-sm"
>
	<DramaIcon class="size-4 shrink-0 text-warning" aria-hidden="true" />
	<p class="min-w-0 flex-1 truncate">
		<span class="font-medium"
			>{t('layout.impersonation.actingAs', { name: impersonation.target.name })}</span
		>
		<span class="text-muted-foreground max-sm:hidden">
			· {t('layout.impersonation.remaining', { count: minutes })}</span
		>
	</p>
	<form method="POST" action="/admin/impersonation/stop">
		<Button type="submit" size="sm" variant="outline">{t('layout.impersonation.stop')}</Button>
	</form>
</div>
