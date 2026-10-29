<script lang="ts">
	// Kachel „Zu erledigen“: offene Handlungen aller Module (`GET /dashboard/feed`), überfällig zuerst.
	// Je Zeile genau eine Handlung; nur die dringendste ist ein gefüllter Knopf. Bleibt auch leer
	// sichtbar („Alles erledigt“), damit die Übersicht ihre Frage immer beantwortet.
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Copy from '@lucide/svelte/icons/copy';
	import { DashboardCard } from '$lib/components/layout';
	import { formatEuro } from '$lib/components/layout/money';
	import { Button } from '$lib/components/ui/button';
	import type { DashboardFeed, DashboardFeedTodo } from '$lib/sdk/types/dashboard';
	import type { DashboardWidgetProps } from '$lib/sdk/types/module-ui';
	import { dueLabel, loadDashboardFeed } from './feed-data';

	let { onstatus }: DashboardWidgetProps = $props();

	const LIMIT = 6;

	let feed = $state<DashboardFeed | null>(null);
	let loading = $state(true);
	let error = $state('');
	let showAll = $state(false);
	let openKey = $state<string | null>(null);

	async function load(fresh = false) {
		loading = true;
		error = '';
		onstatus?.('loading');
		try {
			feed = await loadDashboardFeed(fresh);
			onstatus?.('ready');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Die Liste konnte nicht geladen werden.';
			onstatus?.('error');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
	});

	const todos = $derived(feed?.todos ?? []);
	const shown = $derived(showAll ? todos : todos.slice(0, LIMIT));
	const keyOf = (t: DashboardFeedTodo) => `${t.moduleId}:${t.id}`;
	const failedNames = $derived(feed?.failed.length ? feed.failed.join(', ') : '');

	const SEVERITY_LABEL = { overdue: 'Überfällig', due: 'Bald fällig', info: 'Hinweis' } as const;
	const iban = (v: string) =>
		v
			.replace(/\s+/g, '')
			.replace(/(.{4})/g, '$1 ')
			.trim();

	async function copy(value: string, label: string) {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(`${label} kopiert`);
		} catch {
			toast.error('Kopieren nicht möglich');
		}
	}
</script>

<DashboardCard
	title="Zu erledigen"
	icon={ListChecks}
	{loading}
	{error}
	onretry={() => load(true)}
	skeletonRows={3}
>
	{#snippet actions()}
		{#if todos.length}
			<span class="text-xs text-muted-foreground tabular-nums" aria-label="{todos.length} offen">
				{todos.length}
			</span>
		{/if}
	{/snippet}
	{#if feed}
		{#if !todos.length}
			<p class="py-2" data-testid="todos-empty">
				<span class="block font-medium">Alles erledigt.</span>
				<span class="text-muted-foreground">
					Neue Rechnungen, Fristen und Aufgaben erscheinen hier.
				</span>
			</p>
		{:else}
			<ul class="divide-y" data-testid="todos-list">
				{#each shown as t, i (keyOf(t))}
					{@const key = keyOf(t)}
					{@const open = openKey === key}
					{@const due = dueLabel(t.due, feed.today)}
					<li class="py-2.5">
						<div class="flex items-center gap-3">
							<span
								class={[
									'size-2 shrink-0 rounded-full',
									t.severity === 'overdue'
										? 'bg-destructive'
										: t.severity === 'due'
											? 'bg-primary'
											: 'bg-muted-foreground/40'
								]}
								role="img"
								aria-label={SEVERITY_LABEL[t.severity]}
							></span>
							<div class="min-w-0 flex-1">
								<p class="font-medium break-words">{t.title}</p>
								<p class="text-xs text-muted-foreground">
									{t.detail ?? ''}{t.detail && due ? ' · ' : ''}{#if due}<span
											class={t.severity === 'overdue' ? 'text-destructive' : ''}>{due}</span
										>{/if}
								</p>
							</div>
							{#if t.amountCents !== undefined}
								<span class="hidden shrink-0 font-semibold tabular-nums sm:block">
									{formatEuro(t.amountCents)}
								</span>
							{/if}
							{#if t.payment}
								<Button
									size="sm"
									variant={i === 0 ? 'default' : 'secondary'}
									class="shrink-0"
									aria-expanded={open}
									aria-controls={`pay-${key}`}
									onclick={() => (openKey = open ? null : key)}
								>
									{t.action.label}
								</Button>
							{:else}
								<Button
									size="sm"
									variant={i === 0 ? 'default' : 'secondary'}
									class="shrink-0"
									href={t.action.href}
								>
									{t.action.label}
								</Button>
							{/if}
						</div>
						{#if t.amountCents !== undefined}
							<p class="mt-0.5 pl-5 text-xs font-semibold tabular-nums sm:hidden">
								{formatEuro(t.amountCents)}
							</p>
						{/if}
						{#if t.payment && open}
							{@const pay = t.payment}
							<dl
								id={`pay-${key}`}
								class="mt-2 ml-5 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-md bg-muted/60 p-3 text-xs"
							>
								<dt class="text-muted-foreground">Empfänger</dt>
								<dd class="col-span-2 min-w-0 break-words">{pay.holder}</dd>
								<dt class="text-muted-foreground">IBAN</dt>
								<dd class="min-w-0 font-mono break-all">{iban(pay.iban)}</dd>
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="IBAN kopieren"
									onclick={() => copy(pay.iban.replace(/\s+/g, ''), 'IBAN')}
								>
									<Copy />
								</Button>
								{#if pay.bic}
									<dt class="text-muted-foreground">BIC</dt>
									<dd class="col-span-2 font-mono">{pay.bic}</dd>
								{/if}
								<dt class="text-muted-foreground">Betrag</dt>
								<dd class="col-span-2 tabular-nums">{formatEuro(pay.amountCents)}</dd>
								<dt class="text-muted-foreground">Zweck</dt>
								<dd class="min-w-0 break-words">{pay.reference}</dd>
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="Verwendungszweck kopieren"
									onclick={() => copy(pay.reference, 'Verwendungszweck')}
								>
									<Copy />
								</Button>
								{#if t.action.href !== '/dashboard'}
									<dd class="col-span-3 pt-1">
										<a class="text-link underline-offset-2 hover:underline" href={t.action.href}>
											Rechnung ansehen
										</a>
									</dd>
								{/if}
							</dl>
						{/if}
					</li>
				{/each}
			</ul>
			{#if todos.length > LIMIT}
				<Button variant="ghost" size="sm" class="-ml-2" onclick={() => (showAll = !showAll)}>
					{showAll ? 'Weniger anzeigen' : `Alle ${todos.length} anzeigen`}
				</Button>
			{/if}
		{/if}
		{#if failedNames}
			<p class="pt-2 text-xs text-muted-foreground">
				Nicht geladen: {failedNames}. Bitte später erneut versuchen.
			</p>
		{/if}
	{/if}
</DashboardCard>
