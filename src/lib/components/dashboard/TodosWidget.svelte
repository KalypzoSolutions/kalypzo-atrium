<script lang="ts">
	// Kachel „Zu erledigen“: offene Handlungen aller Module (`GET /dashboard/feed`), überfällig zuerst.
	// Je Zeile genau eine Handlung; nur die dringendste ist ein gefüllter Knopf. Bleibt auch leer
	// sichtbar („Alles erledigt“), damit die Übersicht ihre Frage immer beantwortet.
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Copy from '@lucide/svelte/icons/copy';
	import { DashboardCard } from '$lib/components/layout';
	import { t } from '$lib/i18n';
	import { formatMoney } from '$lib/i18n/intl';
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
			error = e instanceof Error ? e.message : t('widgets.todos.loadFailed');
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
	const keyOf = (todo: DashboardFeedTodo) => `${todo.moduleId}:${todo.id}`;
	const failedNames = $derived(feed?.failed.length ? feed.failed.join(', ') : '');

	const SEVERITY_LABEL = {
		overdue: 'widgets.todos.severity.overdue',
		due: 'widgets.todos.severity.due',
		info: 'widgets.todos.severity.info'
	} as const;
	const iban = (v: string) =>
		v
			.replace(/\s+/g, '')
			.replace(/(.{4})/g, '$1 ')
			.trim();

	async function copy(value: string, label: string) {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(t('widgets.todos.copied', { label }));
		} catch {
			toast.error(t('widgets.todos.copyFailed'));
		}
	}
</script>

<DashboardCard
	title={t('widgets.todos.title')}
	icon={ListChecks}
	{loading}
	{error}
	onretry={() => load(true)}
	skeletonRows={3}
>
	{#snippet actions()}
		{#if todos.length}
			<span
				class="text-xs text-muted-foreground tabular-nums"
				aria-label={t('widgets.todos.openCount', { count: todos.length })}
			>
				{todos.length}
			</span>
		{/if}
	{/snippet}
	{#if feed}
		{#if !todos.length}
			<p class="py-2" data-testid="todos-empty">
				<span class="block font-medium">{t('widgets.todos.allDone')}</span>
				<span class="text-muted-foreground">
					{t('widgets.todos.allDoneHint')}
				</span>
			</p>
		{:else}
			<ul class="divide-y" data-testid="todos-list">
				{#each shown as todo, i (keyOf(todo))}
					{@const key = keyOf(todo)}
					{@const open = openKey === key}
					{@const due = dueLabel(todo.due, feed.today)}
					<li class="py-2.5">
						<div class="flex items-center gap-3">
							<span
								class={[
									'size-2 shrink-0 rounded-full',
									todo.severity === 'overdue'
										? 'bg-destructive'
										: todo.severity === 'due'
											? 'bg-primary'
											: 'bg-muted-foreground/40'
								]}
								role="img"
								aria-label={t(SEVERITY_LABEL[todo.severity])}
							></span>
							<div class="min-w-0 flex-1">
								<p class="font-medium break-words">{todo.title}</p>
								<p class="text-xs text-muted-foreground">
									{todo.detail ?? ''}{todo.detail && due ? ' · ' : ''}{#if due}<span
											class={todo.severity === 'overdue' ? 'text-destructive' : ''}>{due}</span
										>{/if}
								</p>
							</div>
							{#if todo.amountCents !== undefined}
								<span class="hidden shrink-0 font-semibold tabular-nums sm:block">
									{formatMoney(todo.amountCents)}
								</span>
							{/if}
							{#if todo.payment}
								<Button
									size="sm"
									variant={i === 0 ? 'default' : 'secondary'}
									class="shrink-0"
									aria-expanded={open}
									aria-controls={`pay-${key}`}
									onclick={() => (openKey = open ? null : key)}
								>
									{todo.action.label}
								</Button>
							{:else}
								<Button
									size="sm"
									variant={i === 0 ? 'default' : 'secondary'}
									class="shrink-0"
									href={todo.action.href}
								>
									{todo.action.label}
								</Button>
							{/if}
						</div>
						{#if todo.amountCents !== undefined}
							<p class="mt-0.5 pl-5 text-xs font-semibold tabular-nums sm:hidden">
								{formatMoney(todo.amountCents)}
							</p>
						{/if}
						{#if todo.payment && open}
							{@const pay = todo.payment}
							<dl
								id={`pay-${key}`}
								class="mt-2 ml-5 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-md bg-muted/60 p-3 text-xs"
							>
								<dt class="text-muted-foreground">{t('widgets.todos.recipient')}</dt>
								<dd class="col-span-2 min-w-0 break-words">{pay.holder}</dd>
								<dt class="text-muted-foreground">{t('widgets.todos.iban')}</dt>
								<dd class="min-w-0 font-mono break-all">{iban(pay.iban)}</dd>
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label={t('widgets.todos.copyIban')}
									onclick={() => copy(pay.iban.replace(/\s+/g, ''), t('widgets.todos.iban'))}
								>
									<Copy />
								</Button>
								{#if pay.bic}
									<dt class="text-muted-foreground">{t('widgets.todos.bic')}</dt>
									<dd class="col-span-2 font-mono">{pay.bic}</dd>
								{/if}
								<dt class="text-muted-foreground">{t('widgets.todos.amount')}</dt>
								<dd class="col-span-2 tabular-nums">{formatMoney(pay.amountCents)}</dd>
								<dt class="text-muted-foreground">{t('widgets.todos.reference')}</dt>
								<dd class="min-w-0 break-words">{pay.reference}</dd>
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label={t('widgets.todos.copyReference')}
									onclick={() => copy(pay.reference, t('widgets.todos.referenceLong'))}
								>
									<Copy />
								</Button>
								{#if todo.action.href !== '/dashboard'}
									<dd class="col-span-3 pt-1">
										<a class="text-link underline-offset-2 hover:underline" href={todo.action.href}>
											{t('widgets.todos.viewInvoice')}
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
					{showAll
						? t('widgets.todos.showLess')
						: t('widgets.todos.showAll', { count: todos.length })}
				</Button>
			{/if}
		{/if}
		{#if failedNames}
			<p class="pt-2 text-xs text-muted-foreground">
				{t('widgets.todos.failed', { names: failedNames })}
			</p>
		{/if}
	{/if}
</DashboardCard>
