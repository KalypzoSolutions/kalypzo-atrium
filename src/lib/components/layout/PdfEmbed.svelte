<script lang="ts">
	import { t } from '$lib/i18n';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';

	/**
	 * PDF-Vorschau aus einer Blob-/Objekt-URL. Wo der Browser PDFs nicht eingebettet anzeigen kann
	 * (Handys und Tablets: Android-Chrome zeigt nichts, iOS nur die erste Seite), erscheint statt des
	 * `iframe` eine Karte mit „Öffnen“ und „Herunterladen“.
	 */
	let {
		url,
		title,
		fileName = 'dokument.pdf',
		class: className
	}: {
		url: string;
		/** Zugänglicher Titel des Rahmens */
		title: string;
		/** Dateiname für „Herunterladen“ */
		fileName?: string;
		/** Größe/Rahmen des `iframe` (Desktop) */
		class?: string;
	} = $props();

	const canEmbed = $derived.by(() => {
		if (typeof navigator === 'undefined') return true;
		const nav = navigator as Navigator & { pdfViewerEnabled?: boolean };
		if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return false;
		return typeof nav.pdfViewerEnabled === 'boolean' ? nav.pdfViewerEnabled : true;
	});
</script>

{#if canEmbed}
	<iframe {title} src={url} class={cn('h-96 w-full rounded-md border bg-white', className)}
	></iframe>
{:else}
	<div
		class="bg-muted/30 flex flex-col items-center gap-3 rounded-md border p-6 text-center"
		role="group"
		aria-label={title}
	>
		<FileTextIcon class="text-muted-foreground size-10" aria-hidden="true" />
		<p class="text-sm">
			{t('layout.pdf.cannotEmbed')}
		</p>
		<div class="flex flex-wrap justify-center gap-2">
			<Button href={url} target="_blank" rel="noopener">
				<ExternalLinkIcon />
				{t('layout.pdf.open')}
			</Button>
			<Button variant="outline" href={url} download={fileName}>
				<DownloadIcon />
				{t('layout.pdf.download')}
			</Button>
		</div>
	</div>
{/if}
