<script lang="ts">
	/**
	 * Fußzeile mit Datenschutz- und Impressum-Link (Einstellungen `core.legal.privacyUrl` /
	 * `core.legal.imprintUrl`). Für Login und öffentliche Seiten `/p/*`; `notice` ergänzt einen
	 * Hinweis für Seiten, die Daten erheben. Ohne Links wird nichts angezeigt.
	 */
	let {
		privacyUrl = null,
		imprintUrl = null,
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

	const privacy = $derived(safe(privacyUrl));
	const imprint = $derived(safe(imprintUrl));
</script>

{#if privacy || imprint}
	<footer class="text-muted-foreground flex flex-col items-center gap-1 text-xs {className}">
		{#if notice && privacy}
			<p class="text-center">
				Informationen zur Verarbeitung deiner Angaben findest du in der Datenschutzerklärung.
			</p>
		{/if}
		<nav aria-label="Rechtliche Hinweise" class="flex flex-wrap justify-center gap-x-4 gap-y-1">
			{#if privacy}
				<a href={privacy} target="_blank" rel="noopener noreferrer" class="text-link underline">
					Datenschutz
				</a>
			{/if}
			{#if imprint}
				<a href={imprint} target="_blank" rel="noopener noreferrer" class="text-link underline">
					Impressum
				</a>
			{/if}
		</nav>
	</footer>
{/if}
