<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';

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
		parts: Part[];
	}

	let { info }: { info: Info } = $props();

	let only = $state<string | null>(null);
	let loaded = $state(false);
	let failed = $state(false);

	const src = $derived(
		`/pdf/preview?template=${encodeURIComponent(info.id)}` +
			(only ? `&only=${encodeURIComponent(only)}` : '')
	);
	const activePart = $derived(info.parts.find((p) => p.id === only));

	function select(id: string | null) {
		if (only === id) return;
		only = id;
		loaded = false;
		failed = false;
	}

	const num = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex flex-wrap items-center gap-2">
			{info.label}
			{#if info.letterhead}<Badge variant="secondary">Brief</Badge>{/if}
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
			class="relative aspect-[210/297] w-full max-w-[22rem] overflow-hidden rounded-md border bg-white shadow-sm"
		>
			{#if !loaded && !failed}
				<Skeleton class="absolute inset-0 rounded-none" />
			{/if}
			{#if failed}
				<div
					class="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground"
				>
					Vorschau nicht verfügbar (Chromium?)
				</div>
			{:else}
				{#key src}
					<img
						{src}
						alt={activePart
							? `Vorschau der Vorlage „${info.label}“, nur ${activePart.label}`
							: `Seitenvorschau der Vorlage „${info.label}“`}
						loading="lazy"
						class="h-full w-full object-contain"
						onload={() => (loaded = true)}
						onerror={() => (failed = true)}
					/>
				{/key}
			{/if}
		</div>

		{#if info.parts.length > 0}
			<div class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<h3 class="text-sm font-semibold">Bestandteile</h3>
					{#if only}
						<Button variant="ghost" size="sm" onclick={() => select(null)}>Gesamte Seite</Button>
					{/if}
				</div>
				<ul class="divide-y rounded-md border">
					{#each info.parts as part (part.id)}
						<li class="flex flex-wrap items-center justify-between gap-2 p-2.5 text-sm">
							<div class="min-w-0 space-y-0.5">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-medium">{part.label}</span>
									{#if part.optional}<Badge variant="outline">optional</Badge>{/if}
								</div>
								<p class="text-xs text-muted-foreground tabular-nums">
									x {num(part.x)} mm, y {num(part.y)} mm{#if part.width != null && part.height != null}
										· {num(part.width)} × {num(part.height)} mm{/if}
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
								Nur dieser Teil
							</Button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<Button
			variant="outline"
			href={`/pdf/test?template=${encodeURIComponent(info.id)}`}
			data-sveltekit-reload
		>
			Beispiel-PDF herunterladen
		</Button>
	</Card.Content>
</Card.Root>
