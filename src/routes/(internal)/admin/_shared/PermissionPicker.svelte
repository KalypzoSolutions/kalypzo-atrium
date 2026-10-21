<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';

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

	const groups = $derived.by(() => {
		const map = new Map<string, PickerPermission[]>();
		for (const p of permissions) map.set(p.moduleId, [...(map.get(p.moduleId) ?? []), p]);
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
	{#each groups as [moduleId, items] (moduleId)}
		<fieldset class="rounded-lg border p-3">
			<legend class="flex items-center gap-3 px-1 text-sm font-semibold">
				{moduleId}
				{#if !disabled}
					<button
						type="button"
						class="text-xs font-normal text-link underline"
						onclick={() => toggleGroup(items, true)}>alle</button
					>
					<button
						type="button"
						class="text-xs font-normal text-link underline"
						onclick={() => toggleGroup(items, false)}>keine</button
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
								<Badge variant="destructive" class="ml-1">Admin-gleich</Badge>
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
