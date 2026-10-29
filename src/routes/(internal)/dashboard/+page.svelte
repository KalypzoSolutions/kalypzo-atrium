<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import { DashboardCard, EmptyState, PageHeader, PageTitle } from '$lib/components/layout';
	import type { ModuleNavEntry } from '$lib/components/layout/nav';
	import { Button } from '$lib/components/ui/button';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Switch } from '$lib/components/ui/switch';
	import {
		applyDashboardLayout,
		toDashboardLayout,
		type DashboardLayoutPref,
		type ResolvedDashboardWidget
	} from '$lib/sdk/client/dashboard-widgets';
	import type { DashboardWidgetStatus } from '$lib/sdk/types/module-ui';
	import { feedFinding, loadDashboardFeed } from '$lib/components/dashboard/feed-data';
	import { onMount } from 'svelte';

	let { data } = $props();

	// --- Anordnung (lokal überschreibbar, Server-Wert nach jedem Laden) ---
	let pref = $derived<DashboardLayoutPref | null>(data.layout);
	/** Zuletzt erfolgreich gespeicherte Anordnung (Rücksetzpunkt bei Fehlern) */
	let saved = $derived<DashboardLayoutPref | null>(data.layout);
	const arranged = $derived(applyDashboardLayout(data.widgets, pref));

	// --- Komponenten je Schlüssel nur einmal laden (neue Lader nach `invalidate` bauen nichts neu auf) ---
	const loaded = new Map<string, ReturnType<ResolvedDashboardWidget['component']>>();
	function widgetComponent(w: ResolvedDashboardWidget) {
		let p = loaded.get(w.key);
		if (!p) {
			p = w.component();
			loaded.set(w.key, p);
		}
		return p;
	}

	let statuses = $state<Record<string, DashboardWidgetStatus>>({});
	const emptyWidgets = $derived(arranged.visible.filter((w) => statuses[w.key] === 'empty'));
	const allEmpty = $derived(
		arranged.visible.length > 0 && emptyWidgets.length === arranged.visible.length
	);

	const SPAN: Record<string, string> = {
		sm: '',
		md: 'md:col-span-2',
		lg: 'md:col-span-2'
	};

	// --- Kopf: Datum und der wichtigste Befund aus „Zu erledigen“ (gleicher Abruf wie die Kacheln) ---
	let finding = $state<{ text: string; overdue: boolean } | null>(null);
	onMount(() => {
		loadDashboardFeed()
			.then((feed) => {
				const text = feedFinding(feed.todos, feed.today);
				finding = text ? { text, overdue: feed.todos.some((t) => t.severity === 'overdue') } : null;
			})
			.catch(() => (finding = null));
	});
	const today = new Intl.DateTimeFormat('de-DE', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).format(new Date());

	const moduleLabels = $derived.by(() => {
		const m = new Map<string, string>([['core', 'Allgemein']]);
		for (const n of (page.data.navigation ?? []) as ModuleNavEntry[]) {
			if (!m.has(n.moduleId)) m.set(n.moduleId, n.moduleName ?? n.label);
		}
		return m;
	});

	// --- Anpassen ---
	let customizing = $state(false);
	let liveMessage = $state('');
	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let queue: Promise<void> = Promise.resolve();

	async function put(layout: DashboardLayoutPref | null) {
		const res = await fetch('/dashboard/layout', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ layout })
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => null)) as { message?: string } | null;
			throw new Error(body?.message ?? 'Die Anordnung konnte nicht gespeichert werden.');
		}
	}

	/** Optimistisch übernehmen und nacheinander speichern; bei Fehler auf den letzten Stand zurück. */
	function commit(next: DashboardLayoutPref | null) {
		pref = next;
		saveState = 'saving';
		queue = queue.then(async () => {
			try {
				await put(next);
				saved = next;
				if (pref === next) saveState = 'saved';
			} catch (e) {
				pref = saved;
				saveState = 'error';
				toast.error(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
			}
		});
	}

	function setVisible(w: ResolvedDashboardWidget, on: boolean) {
		const hidden = new Set(arranged.hidden);
		if (on) hidden.delete(w.key);
		else hidden.add(w.key);
		liveMessage = `${w.title} ${on ? 'eingeblendet' : 'ausgeblendet'}`;
		commit(toDashboardLayout(arranged.all, hidden));
	}

	function reordered(from: number, to: number) {
		const next = [...arranged.all];
		const [item] = next.splice(from, 1);
		next.splice(to, 0, item!);
		return { next, item: item! };
	}

	function move(from: number, to: number, focusDir?: 'up' | 'down') {
		if (to < 0 || to >= arranged.all.length || from === to) return;
		const { next, item } = reordered(from, to);
		liveMessage = `${item.title} jetzt an Position ${to + 1} von ${next.length}`;
		commit(toDashboardLayout(next, arranged.hidden));
		if (focusDir) {
			queueMicrotask(() => {
				const btn = document.getElementById(`dash-${focusDir}-${to}`) as HTMLButtonElement | null;
				const other = document.getElementById(`dash-${focusDir === 'up' ? 'down' : 'up'}-${to}`);
				(btn && !btn.disabled ? btn : other)?.focus();
			});
		}
	}

	function resetLayout() {
		liveMessage = 'Standard wiederhergestellt';
		commit(null);
	}

	// Ziehen nur am Griff: nur die Zeile mit gedrücktem Griff ist `draggable`
	let armedKey = $state<string | null>(null);
	let dragIndex = $state<number | null>(null);
	let dragMoved = false;

	function onDragStart(e: DragEvent, i: number) {
		dragIndex = i;
		dragMoved = false;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(i));
		}
	}

	function onDragOver(e: DragEvent, i: number) {
		if (dragIndex === null) return;
		e.preventDefault();
		if (i !== dragIndex) {
			// Während des Ziehens nur lokal umstellen, gespeichert wird beim Loslassen
			pref = toDashboardLayout(reordered(dragIndex, i).next, arranged.hidden);
			dragIndex = i;
			dragMoved = true;
		}
	}

	function onDragEnd() {
		if (dragMoved && dragIndex !== null) {
			const w = arranged.all[dragIndex];
			if (w)
				liveMessage = `${w.title} jetzt an Position ${dragIndex + 1} von ${arranged.all.length}`;
			commit(pref);
		}
		dragIndex = null;
		armedKey = null;
		dragMoved = false;
	}
</script>

<PageTitle title="Dashboard" />

<PageHeader title="Dashboard" description={today}>
	{#snippet actions()}
		<Button variant="outline" onclick={() => (customizing = true)}>
			<Settings2 /> Anpassen
		</Button>
	{/snippet}
</PageHeader>

{#if finding}
	<p class="-mt-2 mb-5 flex items-center gap-2 text-sm" data-testid="dashboard-finding">
		<span
			class={['size-2 shrink-0 rounded-full', finding.overdue ? 'bg-destructive' : 'bg-success']}
			aria-hidden="true"
		></span>
		{finding.text}
	</p>
{/if}

{#if arranged.visible.length === 0}
	<EmptyState
		title="Noch keine Kacheln"
		description="Über „Anpassen“ kannst du Kacheln einblenden und anordnen."
	>
		{#if arranged.all.length}
			<Button variant="outline" onclick={() => (customizing = true)}>
				<Settings2 /> Anpassen
			</Button>
		{/if}
	</EmptyState>
{:else}
	<div
		class="grid grid-flow-row-dense items-start gap-4 md:grid-cols-2"
		data-testid="dashboard-grid"
	>
		{#each arranged.visible as w (w.key)}
			<section
				class={[SPAN[w.size ?? 'sm'], statuses[w.key] === 'empty' && 'hidden', 'min-w-0']}
				aria-label={w.title}
				data-widget={w.key}
			>
				{#await widgetComponent(w)}
					<DashboardCard title={w.title} loading />
				{:then mod}
					{@const Widget = mod.default}
					<Widget
						userId={data.user?.id ?? ''}
						size={w.size ?? 'sm'}
						onstatus={(s) => (statuses[w.key] = s)}
					/>
				{:catch}
					<DashboardCard
						title={w.title}
						error="Diese Kachel konnte nicht geladen werden."
						onretry={() => location.reload()}
					/>
				{/await}
			</section>
		{/each}
	</div>
	{#if emptyWidgets.length}
		<p class="mt-4 text-sm text-muted-foreground" data-testid="dashboard-nothing-new">
			{allEmpty ? 'Gerade gibt es nichts Neues' : 'Nichts Neues bei'}: {emptyWidgets
				.map((w) => w.title)
				.join(', ')}
		</p>
	{/if}
{/if}

<Sheet.Root bind:open={customizing}>
	<Sheet.Content side="right" class="w-full overflow-y-auto sm:max-w-md">
		<Sheet.Header class="border-b">
			<Sheet.Title>Dashboard anpassen</Sheet.Title>
			<Sheet.Description>
				Kacheln ein- und ausblenden und die Reihenfolge ändern. Änderungen werden sofort
				gespeichert.
			</Sheet.Description>
		</Sheet.Header>
		<div class="space-y-4 p-4">
			{#if !arranged.all.length}
				<p class="text-sm text-muted-foreground">Für dich sind keine Kacheln verfügbar.</p>
			{:else}
				<ul class="space-y-2" aria-label="Kacheln">
					{#each arranged.all as w, i (w.key)}
						{@const on = !arranged.hidden.has(w.key)}
						<li
							draggable={armedKey === w.key}
							ondragstart={(e) => onDragStart(e, i)}
							ondragover={(e) => onDragOver(e, i)}
							ondrop={(e) => e.preventDefault()}
							ondragend={onDragEnd}
							data-dashboard-row={w.key}
							class={[
								'flex items-center gap-2 rounded-md border bg-background p-2 transition-shadow',
								dragIndex === i && 'opacity-60 shadow-md ring-2 ring-ring'
							]}
						>
							<div
								class="hidden h-9 w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground sm:flex"
								title="Ziehen zum Verschieben"
								aria-hidden="true"
								onpointerdown={() => (armedKey = w.key)}
								onpointerup={() => (armedKey = null)}
							>
								<GripVertical class="size-4" />
							</div>
							<div class="min-w-0 flex-1">
								<label for={`dash-switch-${i}`} class="block truncate text-sm font-medium">
									{w.title}
								</label>
								<p class="truncate text-xs text-muted-foreground">
									{moduleLabels.get(w.moduleId) ?? w.moduleId}{w.description
										? ` · ${w.description}`
										: ''}
								</p>
							</div>
							<div class="flex shrink-0 items-center">
								<Button
									id={`dash-up-${i}`}
									variant="ghost"
									size="icon"
									class="size-8"
									disabled={i === 0}
									aria-label={`${w.title} nach oben`}
									onclick={() => move(i, i - 1, 'up')}
								>
									<ArrowUp />
								</Button>
								<Button
									id={`dash-down-${i}`}
									variant="ghost"
									size="icon"
									class="size-8"
									disabled={i === arranged.all.length - 1}
									aria-label={`${w.title} nach unten`}
									onclick={() => move(i, i + 1, 'down')}
								>
									<ArrowDown />
								</Button>
							</div>
							<Switch
								id={`dash-switch-${i}`}
								checked={on}
								onCheckedChange={(v) => setVisible(w, v)}
								aria-label={`${w.title} anzeigen`}
							/>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="flex flex-wrap items-center justify-between gap-2">
				<Button variant="outline" size="sm" onclick={resetLayout} disabled={pref === null}>
					<RotateCcw /> Standard wiederherstellen
				</Button>
				<span class="text-xs text-muted-foreground" aria-hidden="true">
					{saveState === 'saving'
						? 'Speichert …'
						: saveState === 'saved'
							? 'Gespeichert'
							: saveState === 'error'
								? 'Nicht gespeichert'
								: ''}
				</span>
			</div>
			<p class="sr-only" aria-live="polite">{liveMessage}</p>
		</div>
	</Sheet.Content>
</Sheet.Root>
