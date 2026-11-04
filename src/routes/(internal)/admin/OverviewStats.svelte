<script lang="ts">
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { t } from '$lib/i18n';
	import { formatBytes, formatDate, formatNumber } from '$lib/i18n/intl';
	import type { AdminOverviewStats } from '$lib/server/core/admin/overview-stats';

	/** Kennzahlen-Kacheln oben auf `/admin`; jede Kachel führt zur passenden Seite bzw. gefilterten Liste. */
	let { stats }: { stats: AdminOverviewStats } = $props();

	interface Tile {
		label: string;
		value: string;
		sub?: string;
		href: string;
		warn?: boolean;
	}

	const tiles = $derived.by(() => {
		const list: Tile[] = [];
		const u = stats.users;
		if (u) {
			list.push({
				label: t('admin.stats.accounts'),
				value: formatNumber(u.active),
				sub: t('admin.stats.accountsSub', { total: u.total }),
				href: '/admin/users?status=active'
			});
			list.push({
				label: t('admin.stats.sessions'),
				value: formatNumber(u.sessions),
				href: '/admin/users?sort=lastLogin'
			});
			list.push({
				label: t('admin.stats.failed24h'),
				value: formatNumber(u.failed24h),
				href: '/admin/audit?action=core.auth.login_failed',
				warn: u.failed24h >= 20
			});
			if (u.adminsWithout2fa > 0) {
				list.push({
					label: t('admin.stats.adminsWithout2fa'),
					value: formatNumber(u.adminsWithout2fa),
					sub: t('admin.stats.adminsWithout2faSub'),
					href: '/admin/users?admins=1&tfa=off',
					warn: true
				});
			}
			if (u.neverSignedIn > 0) {
				list.push({
					label: t('admin.stats.neverSignedIn'),
					value: formatNumber(u.neverSignedIn),
					href: '/admin/users?status=never'
				});
			}
			if (u.impersonating > 0) {
				list.push({
					label: t('admin.stats.impersonating'),
					value: formatNumber(u.impersonating),
					href: '/admin/audit?action=core.user.impersonation',
					warn: true
				});
			}
		}
		if (stats.api) {
			list.push({
				label: t('admin.stats.apiCalls'),
				value: formatNumber(stats.api.calls24h),
				sub: t('admin.stats.apiErrors', { count: stats.api.errors24h }),
				href: '/admin/api',
				warn: stats.api.errors24h > 0
			});
		}
		if (stats.storage) {
			list.push({
				label: t('admin.stats.storage'),
				value: formatBytes(stats.storage.bytes),
				sub: t('admin.stats.files', { count: stats.storage.files }),
				href: '/admin/settings/storage'
			});
		}
		if (stats.ai) {
			list.push({
				label: t('admin.stats.aiCost'),
				value: `${formatNumber(stats.ai.costMonthUsd, 2)} USD`,
				sub: t('admin.stats.aiTokens', { count: formatNumber(stats.ai.tokensMonth) }),
				href: '/admin/settings/ai'
			});
		}
		if (stats.jobs && stats.jobs.failed > 0) {
			list.push({
				label: t('admin.stats.jobsFailed'),
				value: formatNumber(stats.jobs.failed),
				href: '/admin/modules',
				warn: true
			});
		}
		return list;
	});

	const logins = $derived(stats.users?.logins ?? []);
	const max = $derived(Math.max(1, ...logins.map((d) => d.count)));
	const W = 300;
	const H = 40;
	const label = (d: { day: string; count: number }) =>
		t('admin.stats.loginsBar', {
			date: formatDate(new Date(`${d.day}T12:00:00Z`)),
			count: d.count
		});
</script>

<section aria-labelledby="admin-stats-title" class="space-y-3">
	<h2 id="admin-stats-title" class="sr-only">{t('admin.stats.title')}</h2>
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#if stats.users}
			<a
				href="/admin/audit?action=core.auth.login"
				class="rounded-lg border bg-card p-4 hover:bg-muted/40 focus-visible:bg-muted/40 sm:col-span-2"
			>
				<span class="flex items-baseline justify-between gap-2">
					<span class="text-xs text-muted-foreground">{t('admin.stats.logins30')}</span>
					<span class="text-lg font-semibold tabular-nums"
						>{formatNumber(stats.users.logins30)}</span
					>
				</span>
				<svg
					viewBox="0 0 {W} {H}"
					preserveAspectRatio="none"
					class="mt-2 h-10 w-full"
					role="img"
					aria-label={t('admin.stats.loginsAria', { count: stats.users.logins30 })}
				>
					{#each logins as d, i (d.day)}
						{@const bw = W / logins.length - 2}
						{@const h = d.count ? Math.max(2, (d.count / max) * H) : 0}
						<rect x={i * (bw + 2)} y="0" width={bw + 2} height={H} fill="transparent"
							><title>{label(d)}</title></rect
						>
						{#if h}<rect
								x={i * (bw + 2)}
								y={H - h}
								width={bw}
								height={h}
								rx="1"
								class="pointer-events-none fill-primary"
							/>{/if}
					{/each}
				</svg>
			</a>
		{/if}
		{#each tiles as tile (tile.label)}
			<a
				href={tile.href}
				class="rounded-lg border bg-card p-4 hover:bg-muted/40 focus-visible:bg-muted/40 {tile.warn
					? 'border-warning-border'
					: ''}"
			>
				<span class="flex items-center gap-1 text-xs text-muted-foreground">
					{#if tile.warn}<TriangleAlertIcon class="size-3.5 text-warning" aria-hidden="true" />{/if}
					{tile.label}
				</span>
				<span class="mt-1 block text-lg font-semibold tabular-nums">{tile.value}</span>
				{#if tile.sub}<span class="block text-xs text-muted-foreground">{tile.sub}</span>{/if}
			</a>
		{/each}
	</div>
</section>
