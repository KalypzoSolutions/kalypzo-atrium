<!--
	Bereichsauswahl für den Export: Gruppen „Core“ und „Module“, „Alle auswählen“,
	implizierte Bereiche (transitiv) automatisch mit Begründung.
-->
<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import { t } from '$lib/i18n';
	import type { BackupScopeInfo } from '$lib/backup/contract';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { impliedOf } from './client';

	let {
		scopes,
		selected = $bindable([]),
		disabled = false
	}: {
		scopes: BackupScopeInfo[];
		/** ausdrücklich gewählte Bereiche */
		selected?: string[];
		disabled?: boolean;
	} = $props();

	const byKey = $derived(new Map(scopes.map((s) => [s.key, s])));

	const implied = $derived(impliedOf(selected, byKey));

	const groups = $derived([
		{
			key: 'core',
			title: t('admin-backup.scopes.core'),
			items: scopes.filter((s) => s.group === 'core')
		},
		{
			key: 'module',
			title: t('admin-backup.scopes.modules'),
			items: scopes.filter((s) => s.group === 'module')
		}
	]);

	const allChecked = $derived(scopes.length > 0 && scopes.every((s) => selected.includes(s.key)));
	const someChecked = $derived(!allChecked && selected.length + implied.size > 0);

	function toggleAll(on: boolean) {
		selected = on ? scopes.map((s) => s.key) : [];
	}

	function toggle(key: string, on: boolean) {
		selected = on ? [...new Set([...selected, key])] : selected.filter((k) => k !== key);
	}

	const labelOf = (key: string) => byKey.get(key)?.label ?? key;
	const cid = (key: string) => `scope-${key.replace(/[^a-z0-9-]/gi, '-')}`;
</script>

<div class="space-y-5">
	<div class="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2">
		<Checkbox
			id="scope-all"
			checked={allChecked}
			indeterminate={someChecked}
			{disabled}
			onCheckedChange={(v) => toggleAll(v === true)}
		/>
		<Label for="scope-all" class="font-medium">{t('admin-backup.scopes.selectAll')}</Label>
		<span class="ml-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
			{t('admin-backup.scopes.count', {
				count: selected.length + implied.size,
				total: scopes.length
			})}
		</span>
	</div>

	{#each groups as g (g.key)}
		{#if g.items.length}
			<fieldset class="space-y-2">
				<legend class="mb-2 text-sm font-semibold">{g.title}</legend>
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{#each g.items as s (s.key)}
						{@const imp = implied.get(s.key)}
						{@const isChecked = selected.includes(s.key) || !!imp}
						<div
							class="flex items-start gap-3 rounded-md border p-3 {isChecked
								? 'border-primary/40 bg-primary/5'
								: ''}"
						>
							<Checkbox
								id={cid(s.key)}
								class="mt-0.5"
								checked={isChecked}
								disabled={!!imp || disabled}
								onCheckedChange={(v) => toggle(s.key, v === true)}
								aria-describedby="{cid(s.key)}-desc"
							/>
							<div class="min-w-0 flex-1 space-y-1">
								<Label for={cid(s.key)} class="flex flex-wrap items-center gap-2 font-medium">
									{s.label}
									{#if !s.enabled}<Badge variant="outline"
											>{t('admin-backup.scopes.inactive')}</Badge
										>{/if}
									{#if imp}
										<Badge variant="secondary"
											><Lock aria-hidden="true" />{t('admin-backup.scopes.automatic')}</Badge
										>
									{/if}
								</Label>
								<p id="{cid(s.key)}-desc" class="text-xs text-muted-foreground">
									{s.description}
								</p>
								{#if imp}
									<p class="text-xs text-warning">
										{t('admin-backup.scopes.impliedBecause', {
											by: labelOf(imp.by),
											reason: imp.reason
										})}
									</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</fieldset>
		{/if}
	{/each}
</div>
