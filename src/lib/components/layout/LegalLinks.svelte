<script lang="ts">
	import { t } from '$lib/i18n';
	/**
	 * Fußzeile mit Datenschutz- und Impressum-Link (Einstellungen `core.legal.privacyUrl` /
	 * `core.legal.imprintUrl`). Für Login und öffentliche Seiten `/p/*`; `notice` ergänzt einen
	 * Hinweis für Seiten, die Daten erheben. Ohne Props kommen die Links aus dem Root-Layout (`page.data.legal`).
	 * Ohne Links wird nichts angezeigt.
	 */
	import { page } from '$app/state';

	let {
		privacyUrl,
		imprintUrl,
		notice = false,
		class: className = ''
	}: {
		privacyUrl?: string | null;
		imprintUrl?: string | null;
		/** Hinweis „Informationen zur Verarbeitung deiner Angaben …“ zeigen */
		notice?: boolean;
		class?: string;
	} = $props();

	/** Nur http(s)-Links ausgeben (keine `javascript:`- o. ä. URLs aus den Einstellungen) */
	function safe(url: string | null | undefined): string | null {
		if (!url) return null;
		try {
			const u = new URL(url);
			return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
		} catch {
			return null;
		}
	}

	const fromLayout = $derived(
		(page.data as { legal?: { privacyUrl: string | null; imprintUrl: string | null } }).legal
	);
	const privacy = $derived(safe(privacyUrl === undefined ? fromLayout?.privacyUrl : privacyUrl));
	const imprint = $derived(safe(imprintUrl === undefined ? fromLayout?.imprintUrl : imprintUrl));
</script>

{#if privacy || imprint}
	<footer class="text-muted-foreground flex flex-col items-center gap-1 text-xs {className}">
		{#if notice && privacy}
			<p class="text-center">
				{t('layout.legal.notice')}
			</p>
		{/if}
		<nav aria-label={t('layout.legal.label')} class="flex flex-wrap justify-center gap-x-4 gap-y-1">
			{#if privacy}
				<a href={privacy} target="_blank" rel="noopener noreferrer" class="text-link underline">
					{t('layout.legal.privacy')}
				</a>
			{/if}
			{#if imprint}
				<a href={imprint} target="_blank" rel="noopener noreferrer" class="text-link underline">
					{t('layout.legal.imprint')}
				</a>
			{/if}
		</nav>
	</footer>
{/if}
