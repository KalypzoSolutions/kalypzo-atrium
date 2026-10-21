<script lang="ts">
	import { untrack } from 'svelte';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Switch } from '$lib/components/ui/switch';
	import {
		CUSTOM_PRESET_ID,
		LIST_COLUMN_GROUPS,
		LIST_COLUMN_GROUP_LABELS,
		NAME_COLUMN_KEY,
		estimatePages,
		normalizeSelection,
		presetColumns,
		selectedColumns,
		selectionHasSensitive,
		type ListCatalog,
		type ListSelection
	} from '$lib/pdf-lists';

	/**
	 * Auswahl-Dialog für PDF-Listen: Voreinstellungen, Spalten je Gruppe, „Leere Spalten ausblenden“,
	 * Seitenschätzung und Hinweis auf Gesundheitsangaben. Die Auswahl wird je `storageKey` im Browser
	 * gemerkt (ohne Speicher funktioniert der Dialog trotzdem). Das Erzeugen übernimmt `onexport`.
	 */
	let {
		open = $bindable(false),
		title = 'PDF-Liste erzeugen',
		catalog,
		count,
		sections = 1,
		storageKey,
		busy = false,
		onexport
	}: {
		open?: boolean;
		title?: string;
		catalog: ListCatalog;
		/** Anzahl Personen (für die Seitenschätzung) */
		count: number;
		/** Anzahl Abschnitte (je Gruppe eine neue Seite) */
		sections?: number;
		/** Schlüssel für `localStorage` (z. B. `pdf-list:members`) */
		storageKey: string;
		busy?: boolean;
		onexport: (selection: ListSelection) => void | Promise<void>;
	} = $props();

	let selection = $state<ListSelection>({ columns: [NAME_COLUMN_KEY], hideEmpty: true });
	let loadedForOpen = false;

	function readStored(): Partial<ListSelection> | undefined {
		try {
			const raw = localStorage.getItem(storageKey);
			return raw ? (JSON.parse(raw) as Partial<ListSelection>) : undefined;
		} catch {
			return undefined;
		}
	}

	function writeStored(sel: ListSelection) {
		try {
			localStorage.setItem(storageKey, JSON.stringify(sel));
		} catch {
			/* ohne Speicher weiter */
		}
	}

	// Beim Öffnen die gemerkte Auswahl laden (einmal je Öffnen)
	$effect(() => {
		if (!open) {
			loadedForOpen = false;
			return;
		}
		if (loadedForOpen) return;
		loadedForOpen = true;
		untrack(() => {
			selection = normalizeSelection(readStored(), catalog.columns, catalog.presets);
		});
	});

	const chosen = $derived(new Set(selection.columns));
	const columns = $derived(selectedColumns(selection, catalog.columns));
	const sensitive = $derived(selectionHasSensitive(selection, catalog.columns));
	const pages = $derived(estimatePages(count, columns, sections));
	const groups = $derived(
		LIST_COLUMN_GROUPS.map((g) => ({
			id: g,
			label: LIST_COLUMN_GROUP_LABELS[g],
			columns: catalog.columns.filter((c) => c.group === g)
		})).filter((g) => g.columns.length)
	);

	function applyPreset(id: string) {
		const preset = catalog.presets.find((p) => p.id === id);
		if (!preset) return;
		selection = {
			...selection,
			preset: preset.id,
			columns: presetColumns(preset, catalog.columns)
		};
	}

	function toggle(key: string, on: boolean) {
		if (key === NAME_COLUMN_KEY) return;
		const next = new Set(selection.columns);
		if (on) next.add(key);
		else next.delete(key);
		selection = normalizeSelection(
			{ columns: [...next], hideEmpty: selection.hideEmpty },
			catalog.columns,
			catalog.presets
		);
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		const final = normalizeSelection(selection, catalog.columns, catalog.presets);
		writeStored(final);
		try {
			await onexport(final);
			open = false;
		} catch {
			/* Fehler zeigt der Aufrufer (Toast); Dialog bleibt offen */
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>
				Wähle, welche Angaben in der Liste stehen – weniger Spalten ergeben weniger Seiten.
			</Dialog.Description>
		</Dialog.Header>

		<form class="space-y-4" onsubmit={submit}>
			<div class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground" id="pdf-list-presets">
					Voreinstellung
				</p>
				<div class="flex flex-wrap gap-2" role="group" aria-labelledby="pdf-list-presets">
					{#each catalog.presets as p (p.id)}
						<Button
							type="button"
							size="sm"
							variant={selection.preset === p.id ? 'default' : 'outline'}
							aria-pressed={selection.preset === p.id}
							title={p.description}
							onclick={() => applyPreset(p.id)}
						>
							{p.label}
						</Button>
					{/each}
					{#if selection.preset === CUSTOM_PRESET_ID}
						<span
							class="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground"
							aria-current="true"
						>
							Eigene Auswahl
						</span>
					{/if}
				</div>
			</div>

			<div class="space-y-4 sm:max-h-[50dvh] sm:overflow-y-auto sm:pr-1">
				{#each groups as g (g.id)}
					<fieldset class="space-y-1">
						<legend class="mb-1 text-xs font-medium text-muted-foreground">{g.label}</legend>
						<div class="grid gap-x-4 sm:grid-cols-2">
							{#each g.columns as c (c.key)}
								<label
									class="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1 text-sm"
								>
									<Checkbox
										checked={chosen.has(c.key)}
										disabled={c.key === NAME_COLUMN_KEY}
										onCheckedChange={(v) => toggle(c.key, v === true)}
										aria-label={c.label}
									/>
									<span class="min-w-0 truncate">{c.label}</span>
									{#if c.sensitive}
										<span class="text-xs text-warning">sensibel</span>
									{/if}
								</label>
							{/each}
						</div>
					</fieldset>
				{/each}
			</div>

			<label class="flex min-h-9 cursor-pointer items-center gap-3 text-sm">
				<Switch bind:checked={selection.hideEmpty} aria-label="Leere Spalten ausblenden" />
				<span>Leere Spalten ausblenden</span>
			</label>

			<p class="text-sm text-muted-foreground" aria-live="polite">
				≈ {pages}
				{pages === 1 ? 'Seite' : 'Seiten'} · {count}
				{count === 1 ? 'Person' : 'Personen'} · {columns.length}
				{columns.length === 1 ? 'Spalte' : 'Spalten'}
			</p>

			{#if sensitive}
				<p
					class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-muted p-2 text-xs"
					role="note"
				>
					<TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
					<span>
						Die Liste enthält Gesundheitsangaben. Nur für den vorgesehenen Zweck verwenden und
						danach vernichten.
					</span>
				</p>
			{/if}

			<Dialog.Footer class="sticky -bottom-4 -mx-4 -mb-4 bg-background px-4 pb-4 pt-2">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
				<Button type="submit" disabled={busy}>{busy ? 'Erzeuge PDF …' : 'PDF erzeugen'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
