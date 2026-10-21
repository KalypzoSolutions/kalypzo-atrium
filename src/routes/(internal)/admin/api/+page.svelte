<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import { addDays, todayBerlin } from '$lib/sdk/dates';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import DataTable from '$lib/components/layout/DataTable.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import { submitHandler } from '../_shared/form-utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	type KeyRow = PageData['keys'][number];

	let createOpen = $state(false);
	let keyOpen = $state(false);
	let revokeOpen = $state(false);
	let busy = $state(false);
	let formError = $state('');
	let newKey = $state('');
	let newName = $state('');
	let toRevoke = $state<KeyRow | null>(null);
	let scopeFilter = $state('');
	/** Gewählte Scopes – bleiben beim Filtern erhalten (versteckte Felder für den Formular-POST) */
	let chosenScopes = $state<string[]>([]);
	function toggleScope(key: string, on: boolean) {
		chosenScopes = on
			? [...new Set([...chosenScopes, key])]
			: chosenScopes.filter((k) => k !== key);
	}

	const visibleScopes = $derived(
		data.scopes.filter((s) => s.key.includes(scopeFilter.trim().toLowerCase()))
	);

	function status(k: KeyRow): { label: string; variant: 'default' | 'secondary' | 'destructive' } {
		if (k.revokedAt) return { label: 'Widerrufen', variant: 'destructive' };
		if (k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now()) {
			return { label: 'Abgelaufen', variant: 'secondary' };
		}
		return { label: 'Aktiv', variant: 'default' };
	}

	function fmt(d: Date | null) {
		return d ? new Date(d).toLocaleString('de-DE') : '–';
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(newKey);
			toast.success('In die Zwischenablage kopiert');
		} catch {
			toast.error('Kopieren nicht möglich – bitte manuell markieren');
		}
	}

	const createHandler = submitHandler({
		busy: (b) => (busy = b),
		error: (m) => (formError = m),
		success: (d) => {
			createOpen = false;
			newKey = String(d.key ?? '');
			newName = String(d.name ?? '');
			keyOpen = true;
		}
	});

	const revokeHandler = submitHandler({
		busy: (b) => (busy = b),
		error: (m) => (formError = m),
		success: () => (revokeOpen = false)
	});

	const tomorrow = addDays(todayBerlin(), 1);
</script>

<PageTitle title="API-Keys" />

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-section">API-Keys</h2>
			<p class="text-sm text-muted-foreground">
				Schlüssel für externe Dienste. Wirksame Rechte sind die Schnittmenge aus Scopes und deinen
				eigenen Berechtigungen.
			</p>
		</div>
		{#if data.canManage}
			<Button
				onclick={() => (
					(formError = ''),
					(scopeFilter = ''),
					(chosenScopes = []),
					(createOpen = true)
				)}
			>
				API-Key erstellen
			</Button>
		{/if}
	</div>

	<DataTable
		mobile="cards"
		caption="API-Keys"
		empty={data.keys.length === 0}
		emptyTitle="Noch keine API-Keys vorhanden."
	>
		{#snippet head()}
			<Table.Row>
				<Table.Head>Name</Table.Head>
				<Table.Head>Präfix</Table.Head>
				<Table.Head>Scopes</Table.Head>
				<Table.Head>Status</Table.Head>
				<Table.Head>Läuft ab</Table.Head>
				<Table.Head>Zuletzt benutzt</Table.Head>
				<Table.Head class="text-right">Aktionen</Table.Head>
			</Table.Row>
		{/snippet}
		{#each data.keys as k (k.id)}
			{@const st = status(k)}
			<Table.Row>
				<Table.Cell class="font-medium">{k.name}</Table.Cell>
				<Table.Cell><code class="text-xs">{k.prefix}…</code></Table.Cell>
				<Table.Cell>
					<details>
						<summary class="cursor-pointer text-sm">{k.scopes.length} Scopes</summary>
						<ul class="mt-1 space-y-0.5 text-xs">
							{#each k.scopes as s (s)}<li><code>{s}</code></li>{/each}
						</ul>
					</details>
				</Table.Cell>
				<Table.Cell><Badge variant={st.variant}>{st.label}</Badge></Table.Cell>
				<Table.Cell>{fmt(k.expiresAt)}</Table.Cell>
				<Table.Cell>{fmt(k.lastUsedAt)}</Table.Cell>
				<Table.Cell class="text-right">
					{#if data.canManage && !k.revokedAt}
						<Button
							size="sm"
							variant="destructive"
							onclick={() => ((toRevoke = k), (formError = ''), (revokeOpen = true))}
						>
							Widerrufen
						</Button>
					{/if}
				</Table.Cell>
			</Table.Row>
		{/each}
	</DataTable>
</div>

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>API-Key erstellen</Dialog.Title>
			<Dialog.Description>
				Der Schlüssel wird nach dem Erstellen nur ein einziges Mal angezeigt.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/create" class="space-y-4" use:enhance={createHandler}>
			<div class="space-y-2">
				<Label for="k-name">Name</Label>
				<Input
					id="k-name"
					name="name"
					required
					minlength={2}
					maxlength={80}
					placeholder="z. B. Buchhaltung-Export"
				/>
			</div>
			<div class="space-y-2">
				<Label for="k-exp">Ablaufdatum (optional)</Label>
				<Input id="k-exp" name="expiresAt" type="date" min={tomorrow} />
			</div>
			<fieldset class="space-y-2">
				<legend class="text-sm font-medium">Scopes</legend>
				<Input
					type="search"
					placeholder="Scopes filtern …"
					aria-label="Scopes filtern"
					bind:value={scopeFilter}
				/>
				<div class="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
					{#each chosenScopes as k (k)}<input type="hidden" name="scopes" value={k} />{/each}
					{#each visibleScopes as s (s.key)}
						{@const cid = `scope-${s.key.replace(/[^a-z0-9-]/g, '-')}`}
						<div class="flex items-start gap-2 text-sm">
							<Checkbox
								id={cid}
								class="mt-0.5"
								aria-label={s.key}
								aria-describedby={s.description ? `${cid}-desc` : undefined}
								checked={chosenScopes.includes(s.key)}
								onCheckedChange={(v) => toggleScope(s.key, v)}
							/>
							<label for={cid}>
								<code class="text-xs">{s.key}</code>
								{#if s.description}
									<span id={`${cid}-desc`} class="block text-xs text-muted-foreground"
										>{s.description}</span
									>
								{/if}
							</label>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">Keine Scopes gefunden.</p>
					{/each}
				</div>
			</fieldset>
			{#if formError}<p class="text-sm text-destructive" role="alert">{formError}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (createOpen = false)}
					>Abbrechen</Button
				>
				<Button type="submit" disabled={busy}>{busy ? 'Erstelle …' : 'Erstellen'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	bind:open={keyOpen}
	onOpenChange={(o) => {
		if (!o) newKey = '';
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>API-Key „{newName}“ erstellt</Dialog.Title>
			<Dialog.Description>
				Kopiere den Schlüssel jetzt und bewahre ihn sicher auf. Er kann später nicht mehr angezeigt
				werden.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-3">
			<Input
				readonly
				value={newKey}
				aria-label="API-Key"
				onfocus={(e) => e.currentTarget.select()}
				class="font-mono text-xs"
			/>
			<Button variant="outline" onclick={copy}>Kopieren</Button>
		</div>
		<Dialog.Footer>
			<Button onclick={() => (keyOpen = false)}>Fertig, ich habe den Schlüssel gespeichert</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={revokeOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>API-Key widerrufen?</Dialog.Title>
			<Dialog.Description>
				„{toRevoke?.name}“ ({toRevoke?.prefix}…) wird sofort ungültig. Das kann nicht rückgängig
				gemacht werden.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/revoke" use:enhance={revokeHandler}>
			<input type="hidden" name="id" value={toRevoke?.id ?? ''} />
			{#if formError}<p class="mb-3 text-sm text-destructive" role="alert">{formError}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (revokeOpen = false)}
					>Abbrechen</Button
				>
				<Button type="submit" variant="destructive" disabled={busy}>Widerrufen</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
