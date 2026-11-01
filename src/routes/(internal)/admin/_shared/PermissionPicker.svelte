<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import Search from '@lucide/svelte/icons/search';
	import { t } from '$lib/i18n';

	export interface PickerPermission {
		key: string;
		moduleId: string;
		description: string | null;
		/** darf die handelnde Person dieses Recht vergeben? */
		grantable: boolean;
		/** admin-gleiches Recht */
		privileged: boolean;
	}

	let {
		permissions,
		selected = $bindable([]),
		idPrefix = 'perm',
		disabled = false
	}: {
		permissions: PickerPermission[];
		selected?: string[];
		idPrefix?: string;
		disabled?: boolean;
	} = $props();

	/** Suche ab dieser Anzahl Rechte einblenden */
	const SEARCH_FROM = 8;
	let query = $state('');

	/** Kleinschreibung, Umlaute/ß gefaltet, damit „gebuhr“ auch „Gebühr“ findet */
	const fold = (t: string) =>
		t.toLocaleLowerCase('de-DE').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');

	/** Alle Wörter müssen in Schlüssel, Modul oder Beschreibung vorkommen */
	const visible = $derived.by(() => {
		const words = fold(query).split(/\s+/).filter(Boolean);
		if (!words.length) return permissions;
		return permissions.filter((p) => {
			const hay = fold(`${p.key} ${p.moduleId} ${p.description ?? ''}`);
			return words.every((w) => hay.includes(w));
		});
	});

	const groups = $derived.by(() => {
		const map = new Map<string, PickerPermission[]>();
		for (const p of visible) map.set(p.moduleId, [...(map.get(p.moduleId) ?? []), p]);
		return [...map.entries()];
	});

	function toggle(key: string, on: boolean) {
		selected = on ? [...new Set([...selected, key])] : selected.filter((k) => k !== key);
	}
	function toggleGroup(items: PickerPermission[], on: boolean) {
		const keys = items.filter((p) => p.grantable).map((p) => p.key);
		selected = on
			? [...new Set([...selected, ...keys])]
			: selected.filter((k) => !keys.includes(k));
	}
</script>

<div class="space-y-3">
	{#if permissions.length >= SEARCH_FROM}
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				type="search"
				class="pl-8"
				aria-label={t('admin.permissionPicker.searchLabel')}
				placeholder={t('admin.permissionPicker.searchPlaceholder')}
				bind:value={query}
			/>
		</div>
		{#if query.trim()}
			<p class="text-xs text-muted-foreground" aria-live="polite">
				{t(
					visible.length ? 'admin.permissionPicker.countHits' : 'admin.permissionPicker.countNone',
					{
						visible: visible.length,
						total: permissions.length
					}
				)}
			</p>
		{/if}
	{/if}
	{#each groups as [moduleId, items] (moduleId)}
		<fieldset class="rounded-lg border p-3">
			<legend class="flex items-center gap-3 px-1 text-sm font-semibold">
				{moduleId}
				{#if !disabled}
					<button
						type="button"
						class="text-xs font-normal text-link underline"
						onclick={() => toggleGroup(items, true)}>{t('admin.permissionPicker.all')}</button
					>
					<button
						type="button"
						class="text-xs font-normal text-link underline"
						onclick={() => toggleGroup(items, false)}>{t('admin.permissionPicker.none')}</button
					>
				{/if}
			</legend>
			<div class="grid gap-1 sm:grid-cols-2">
				{#each items as p (p.key)}
					{@const on = selected.includes(p.key)}
					{@const cid = `${idPrefix}-${p.key.replace(/[^a-z0-9-]/g, '-')}`}
					<div class="flex items-start gap-2 text-sm" class:opacity-50={!p.grantable && !on}>
						<Checkbox
							id={cid}
							class="mt-0.5"
							aria-label={p.key}
							aria-describedby={p.description ? `${cid}-desc` : undefined}
							checked={on}
							disabled={disabled || !p.grantable}
							onCheckedChange={(v) => toggle(p.key, v === true)}
						/>
						<label for={cid}>
							<code class="text-xs">{p.key}</code>
							{#if p.privileged}
								<Badge variant="destructive" class="ml-1"
									>{t('admin.permissionPicker.privileged')}</Badge
								>
							{/if}
							{#if p.description}
								<span id={`${cid}-desc`} class="block text-xs text-muted-foreground"
									>{p.description}</span
								>
							{/if}
						</label>
					</div>
				{/each}
			</div>
		</fieldset>
	{/each}
</div>
