<script lang="ts">
	import FileUp from '@lucide/svelte/icons/file-up';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import ImageCropDialog from './ImageCropDialog.svelte';
	import { CROP_SOURCE_MAX_BYTES, type ImageCropOptions } from './image-crop';
	import { openProtectedFile } from './open-file';

	/**
	 * Einheitliches Datei-Feld: zeigt eine vorhandene Datei (Link + Entfernen), erlaubt Auswahl
	 * einer neuen Datei mit Typ- und Größenprüfung und meldet Fehler konsistent.
	 * Mit `crop` öffnet die Auswahl eines Bildes zuerst den Zuschnitt; `file` ist dann das zugeschnittene Bild
	 * (auch im nativen Formular-Submit), `maxBytes` gilt für das Ergebnis, das Original darf bis 25 MB groß sein.
	 */
	let {
		id,
		name,
		required = false,
		file = $bindable(null),
		accept,
		maxBytes,
		existingName = null,
		existingHref = null,
		canUpload = true,
		canRemove = false,
		onremove,
		disabled = false,
		error = null,
		crop
	}: {
		id: string;
		/** Feldname für native Formular-Submits (SvelteKit-Actions) */
		name?: string;
		required?: boolean;
		file?: File | null;
		/** Wie das HTML-Attribut, z. B. `application/pdf,image/*` */
		accept?: string;
		maxBytes?: number;
		existingName?: string | null;
		existingHref?: string | null;
		canUpload?: boolean;
		canRemove?: boolean;
		onremove?: () => void;
		disabled?: boolean;
		error?: string | null;
		crop?: ImageCropOptions;
	} = $props();

	let localError = $state('');
	let input = $state<HTMLInputElement | null>(null);
	const shownError = $derived(error ?? (localError || null));

	const fmtSize = (n: number) =>
		n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;

	function accepted(f: File): boolean {
		if (!accept) return true;
		return accept
			.split(',')
			.map((a) => a.trim().toLowerCase())
			.some((a) =>
				a.endsWith('/*')
					? f.type.toLowerCase().startsWith(a.slice(0, -1))
					: a.startsWith('.')
						? f.name.toLowerCase().endsWith(a)
						: f.type.toLowerCase() === a
			);
	}

	function onpick(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		localError = '';
		if (!f) {
			file = null;
			return;
		}
		if (!accepted(f)) {
			localError = 'Dateityp nicht erlaubt';
			file = null;
		} else if (crop) {
			if (f.size > CROP_SOURCE_MAX_BYTES) {
				localError = `Datei ist zu groß (maximal ${fmtSize(CROP_SOURCE_MAX_BYTES)})`;
				file = null;
			} else {
				file = null;
				cropSource = f;
				cropOpen = true;
				return;
			}
		} else if (maxBytes && f.size > maxBytes) {
			localError = `Datei ist zu groß (maximal ${fmtSize(maxBytes)})`;
			file = null;
		} else {
			file = f;
		}
		if (!file && input) input.value = '';
	}

	// --- Zuschnitt
	let cropSource = $state<File | null>(null);
	let cropOpen = $state(false);

	function onCropped(out: File) {
		if (maxBytes && out.size > maxBytes) {
			localError = `Zugeschnittenes Bild ist zu groß (maximal ${fmtSize(maxBytes)})`;
			clear();
			return;
		}
		localError = '';
		file = out;
		// Native Formular-Submits sollen das zugeschnittene Bild senden, nicht das Original
		try {
			const dt = new DataTransfer();
			dt.items.add(out);
			if (input) input.files = dt.files;
		} catch {
			// Sehr alte Browser: dann geht nur der gebundene Wert (`file`) weiter
		}
	}

	function onCropCancel() {
		// Erneutes Zuschneiden abgebrochen → bisheriger Ausschnitt bleibt
		if (!file) clear();
	}

	/** Vorhandene Datei per fetch öffnen, damit Fehler (503 ohne S3, 404) als Toast erscheinen. */
	let opening = $state(false);
	async function openExisting(e: MouseEvent) {
		e.preventDefault();
		if (!existingHref || opening) return;
		opening = true;
		try {
			await openProtectedFile(existingHref, { fallbackName: existingName ?? undefined });
		} finally {
			opening = false;
		}
	}

	function clear() {
		file = null;
		cropSource = null;
		localError = '';
		if (input) input.value = '';
	}
</script>

<div class="grid gap-2">
	{#if existingName}
		<div class="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
			<span class="flex min-w-0 items-center gap-2 text-sm">
				<FileUp class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				{#if existingHref}
					<a
						href={existingHref}
						target="_blank"
						rel="noopener"
						class="truncate underline aria-busy:cursor-progress aria-busy:opacity-60"
						aria-busy={opening || undefined}
						onclick={openExisting}
					>
						{existingName}
					</a>
				{:else}
					<span class="truncate">{existingName}</span>
				{/if}
			</span>
			{#if canRemove && onremove}
				<Button type="button" variant="ghost" size="sm" {disabled} onclick={onremove}>
					Entfernen
				</Button>
			{/if}
		</div>
	{/if}

	{#if canUpload}
		<Input
			bind:ref={input}
			{id}
			{name}
			{required}
			type="file"
			{accept}
			{disabled}
			aria-invalid={shownError ? true : undefined}
			aria-describedby={shownError ? `${id}-error` : undefined}
			onchange={onpick}
		/>
		{#if file}
			<p class="flex items-center gap-2 text-xs text-muted-foreground">
				<span class="truncate">{file.name} ({fmtSize(file.size)})</span>
				<button
					type="button"
					class="inline-flex items-center rounded p-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					aria-label="Auswahl entfernen"
					onclick={clear}
				>
					<X class="size-3.5" />
				</button>
				{#if crop && cropSource}
					<button
						type="button"
						class="text-link underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						{disabled}
						onclick={() => (cropOpen = true)}
					>
						Ausschnitt ändern
					</button>
				{/if}
			</p>
		{/if}
	{/if}

	{#if shownError}
		<p id="{id}-error" role="alert" class="text-xs text-destructive">{shownError}</p>
	{/if}
</div>

{#if crop}
	<ImageCropDialog
		bind:open={cropOpen}
		file={cropSource}
		aspect={crop.aspect}
		shape={crop.shape}
		maxEdge={crop.maxEdge}
		title={crop.title}
		onconfirm={onCropped}
		oncancel={onCropCancel}
	/>
{/if}
