<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { LoadingState } from '$lib/components/layout';
	import { t } from '$lib/i18n';
	import { formatNumber } from '$lib/i18n/intl';

	interface Part {
		id: string;
		label: string;
		description?: string;
		optional?: boolean;
		x: number;
		y: number;
		width?: number;
		height?: number;
	}
	interface Info {
		id: string;
		label: string;
		description: string | null;
		source: string | null;
		letterhead: boolean;
		orientation: 'portrait' | 'landscape';
		parts: Part[];
		origin: { type: 'core' } | { type: 'module'; moduleId: string; moduleName: string };
		replacesCore: boolean;
	}

	let { info }: { info: Info } = $props();

	let only = $state<string | null>(null);
	let loaded = $state(false);
	let failed = $state(false);

	const src = $derived(
		`/admin/settings/pdf/preview?template=${encodeURIComponent(info.id)}` +
			(only ? `&only=${encodeURIComponent(only)}` : '')
	);
	const activePart = $derived(info.parts.find((p) => p.id === only));
	const landscape = $derived(info.orientation === 'landscape');

	function select(id: string | null) {
		if (only === id) return;
		only = id;
		loaded = false;
		failed = false;
	}

	/**
	 * Lade-Listener per Action statt `onload`/`onerror`-Attribut: Inline-Handler aus dem SSR blockiert die
	 * CSP (script-src mit Nonce). Berücksichtigt Bilder, die schon vor der Hydration fertig waren.
	 */
	function watchImage(img: HTMLImageElement) {
		const ok = () => (loaded = true);
		const fail = () => (failed = true);
		img.addEventListener('load', ok);
		img.addEventListener('error', fail);
		if (img.complete) {
			if (img.naturalWidth > 0) ok();
			else if (img.getAttribute('src')) fail();
		}
		return {
			destroy() {
				img.removeEventListener('load', ok);
				img.removeEventListener('error', fail);
			}
		};
	}

	const num = (n: number) => formatNumber(Math.round(n * 10) / 10);
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex flex-wrap items-center gap-2">
			{info.label}
			{#if info.letterhead}<Badge variant="secondary">{t('admin-pdf.card.letter')}</Badge>{/if}
			{#if landscape}<Badge variant="outline">{t('admin-pdf.card.landscape')}</Badge>{/if}
			{#if info.origin.type === 'module'}
				<Badge variant="outline">
					{info.replacesCore
						? t('admin-pdf.card.replacedBy', { module: info.origin.moduleName })
						: t('admin-pdf.card.fromModule', { module: info.origin.moduleName })}
				</Badge>
			{/if}
		</Card.Title>
		<Card.Description>
			<span class="font-mono text-xs">{info.id}</span>
			{#if info.source}
				<span aria-hidden="true">·</span>
				<span class="font-mono text-xs">{info.source}</span>
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		{#if info.description}<p class="text-sm">{info.description}</p>{/if}

		<div
			class={[
				'relative w-full overflow-hidden rounded-md border bg-white shadow-sm',
				landscape ? 'aspect-[297/210] max-w-[31rem]' : 'aspect-[210/297] max-w-[22rem]'
			]}
		>
			{#if !loaded && !failed}
				<LoadingState
					label={t('admin-pdf.card.preview')}
					rows={1}
					rowClass="h-full w-full rounded-none"
					class="absolute inset-0"
				/>
			{/if}
			{#if failed}
				<div
					class="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground"
				>
					{t('admin-pdf.card.previewUnavailable')}
				</div>
			{:else}
				{#key src}
					<img
						{src}
						alt={activePart
							? t('admin-pdf.card.previewPartAlt', { template: info.label, part: activePart.label })
							: t('admin-pdf.card.previewAlt', { template: info.label })}
						loading="lazy"
						class="h-full w-full object-contain"
						use:watchImage
					/>
				{/key}
			{/if}
		</div>

		{#if info.parts.length > 0}
			<div class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<h3 class="text-sm font-semibold">{t('admin-pdf.card.parts')}</h3>
					{#if only}
						<Button variant="ghost" size="sm" onclick={() => select(null)}
							>{t('admin-pdf.card.wholePage')}</Button
						>
					{/if}
				</div>
				<ul class="divide-y rounded-md border">
					{#each info.parts as part (part.id)}
						<li class="flex flex-wrap items-center justify-between gap-2 p-2.5 text-sm">
							<div class="min-w-0 space-y-0.5">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-medium">{part.label}</span>
									{#if part.optional}<Badge variant="outline">{t('admin-pdf.card.optional')}</Badge
										>{/if}
								</div>
								<p class="text-xs text-muted-foreground tabular-nums">
									{t('admin-pdf.card.position', {
										x: num(part.x),
										y: num(part.y)
									})}{#if part.width != null && part.height != null}
										· {t('admin-pdf.card.size', {
											width: num(part.width),
											height: num(part.height)
										})}{/if}
								</p>
								{#if part.description}
									<p class="text-xs text-muted-foreground">{part.description}</p>
								{/if}
							</div>
							<Button
								variant={only === part.id ? 'secondary' : 'outline'}
								size="sm"
								aria-pressed={only === part.id}
								onclick={() => select(only === part.id ? null : part.id)}
							>
								{t('admin-pdf.card.onlyThisPart')}
							</Button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<Button
			variant="outline"
			href={`/admin/settings/pdf/test?template=${encodeURIComponent(info.id)}`}
			data-sveltekit-reload
		>
			{t('admin-pdf.card.downloadSample')}
		</Button>
	</Card.Content>
</Card.Root>
