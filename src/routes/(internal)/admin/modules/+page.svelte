<script lang="ts">
	import { enhance } from '$app/forms';
	import { PageTitle } from '$lib/components/layout';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { FormField } from '$lib/components/layout';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import type { UpdateInfo } from '$lib/server/core/modules/install/manage';
	import AccountFields from '../backup/AccountFields.svelte';
	import { submitHandler } from '../_shared/form-utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busyId = $state<string | null>(null);
	let errors = $state<Record<string, string>>({});

	// Updates, Entfernen, Wiederherstellen (Kalypzo Atrium)
	let updates = $state<UpdateInfo[] | null>(null);
	let checking = $state(false);
	let removeTarget = $state<{ id: string; name: string; hasCode: boolean } | null>(null);
	let deleteData = $state(false);
	let confirmId = $state('');
	let password = $state('');
	let totp = $state('');
	let fields = $state<Record<string, string>>({});
	let working = $state(false);

	const UPDATE_STATUS: Record<UpdateInfo['status'], string> = {
		current: 'aktuell',
		update: 'Update verfügbar',
		'no-source': 'keine Quelle',
		error: 'Fehler'
	};

	/** Formular mit Feldfehlern, Ergebnis an `onok` */
	function action(onok: (d: Record<string, unknown>) => void): SubmitFunction {
		return () => {
			working = true;
			fields = {};
			return async ({ result }) => {
				working = false;
				if (result.type === 'success') {
					const d = (result.data ?? {}) as Record<string, unknown>;
					if (d.message) toast.success(String(d.message));
					onok(d);
					await invalidateAll();
				} else if (result.type === 'failure') {
					const d = (result.data ?? {}) as { message?: string; fields?: Record<string, string> };
					fields = d.fields ?? {};
					toast.error(d.message ?? 'Aktion fehlgeschlagen');
				} else if (result.type === 'error') toast.error('Unerwarteter Fehler');
			};
		};
	}

	const onCheck: SubmitFunction = () => {
		checking = true;
		return async ({ result }) => {
			checking = false;
			if (result.type === 'success') updates = (result.data?.updates ?? []) as UpdateInfo[];
			else if (result.type === 'failure') toast.error(String(result.data?.message ?? 'Fehler'));
		};
	};

	function openRemove(id: string, name: string, hasCode: boolean) {
		removeTarget = { id, name, hasCode };
		deleteData = !hasCode;
		confirmId = '';
		password = '';
		totp = '';
		fields = {};
	}

	const installHref = (u: UpdateInfo) =>
		`/admin/modules/install?url=${encodeURIComponent(u.source ?? '')}&select=${encodeURIComponent(u.id)}`;

	function handler(id: string) {
		return submitHandler({
			busy: (b) => (busyId = b ? id : null),
			error: (m) => (errors = { ...errors, [id]: m })
		});
	}
</script>

<PageTitle title="Module" />

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-muted-foreground">
			Im Build enthaltene Module. Aktivierte Module erscheinen in der Navigation und der API.
		</p>
		{#if data.canInstall}
			<form method="POST" action="?/checkUpdates" use:enhance={onCheck}>
				<Button type="submit" variant="outline" disabled={checking}>
					{checking ? 'Prüft …' : 'Nach Updates suchen'}
				</Button>
			</form>
		{/if}
	</div>

	{#if updates}
		<Card.Root>
			<Card.Header>
				<Card.Title>Updates</Card.Title>
				<Card.Description>
					Vergleicht den gespeicherten Commit mit dem aktuellen Stand der Quelle. Vor einem Update
					empfiehlt sich eine <a class="text-link" href="/admin/backup">Datensicherung</a>.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if !updates.length}
					<p class="text-sm text-muted-foreground">
						Keine Module aus einer Quelle installiert – Module aus dem Build werden mit dem Server
						aktualisiert.
					</p>
				{:else}
					<ul class="divide-y rounded-md border text-sm">
						{#each updates as u (u.id)}
							<li class="flex flex-wrap items-center gap-3 p-3">
								<span class="min-w-0 flex-1">
									<span class="font-medium">{u.name}</span>
									<code class="ml-1 text-xs text-muted-foreground">{u.id}</code>
									<span class="block text-xs text-muted-foreground">
										{u.installedVersion}{u.commit ? ` · ${u.commit.slice(0, 7)}` : ''}
										{#if u.status === 'update'}
											→ {u.latestVersion}{u.latestCommit ? ` · ${u.latestCommit.slice(0, 7)}` : ''}
										{/if}
										{#if u.message}· {u.message}{/if}
									</span>
								</span>
								<Badge
									variant={u.status === 'update'
										? 'info'
										: u.status === 'error'
											? 'destructive'
											: 'secondary'}>{UPDATE_STATUS[u.status]}</Badge
								>
								{#if u.status === 'update' && u.source}
									<Button href={installHref(u)} size="sm">Aktualisieren</Button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if data.drift.length}
		<Alert.Root variant="warning">
			<Alert.Title>Installierte Module fehlen im laufenden Stand</Alert.Title>
			<Alert.Description class="space-y-3">
				<p>
					Laut Datenbank sind diese Module installiert, laufen aber nicht (z. B. nach einer
					Wiederherstellung auf einem neuen Server):
					{data.drift.map((d) => `${d.id} ${d.version} (${d.source})`).join(', ')}.
				</p>
				{#if data.canInstall && data.drift.some((d) => d.restorable)}
					<form
						method="POST"
						action="?/restore"
						use:enhance={action(() => {})}
						class="grid max-w-xl gap-3 sm:grid-cols-2"
					>
						<AccountFields
							idPrefix="restore"
							bind:password
							bind:totp
							twoFactorEnabled={data.twoFactorEnabled}
							disabled={working}
							errors={fields}
						/>
						<input type="hidden" name="password" value={password} />
						<input type="hidden" name="totp" value={totp} />
						<div class="sm:col-span-2">
							<Button
								type="submit"
								disabled={working || !password || !data.installStatus.available}
							>
								{working ? 'Bitte warten …' : 'Aus der Datenbank wiederherstellen'}
							</Button>
							{#if !data.installStatus.available && data.installStatus.reason}
								<p class="mt-1 text-xs">{data.installStatus.reason}</p>
							{/if}
						</div>
					</form>
				{/if}
			</Alert.Description>
		</Alert.Root>
	{/if}

	{#if data.problems.length}
		<section class="space-y-3" aria-labelledby="module-problems">
			<h2 id="module-problems" class="text-section">Nicht geladen</h2>
			<Alert.Root variant="warning">
				<Alert.Title>Diese Module laufen nicht</Alert.Title>
				<Alert.Description>
					Ihre Daten bleiben erhalten. Nach dem Beheben (Modul aktualisieren oder fehlende Module
					installieren) sind sie wieder da.
				</Alert.Description>
			</Alert.Root>
			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{#each data.problems as p (p.id)}
					<Card.Root>
						<Card.Header>
							<Card.Title level={3} class="flex flex-wrap items-center gap-2">
								{p.name}
								{#if p.kind === 'broken'}<Badge variant="destructive">Defekt</Badge>{:else}<Badge
										variant="warning">Nicht installiert</Badge
									>{/if}
								{#if p.enabled}<Badge variant="outline">war aktiv</Badge>{/if}
							</Card.Title>
						</Card.Header>
						<Card.Content class="space-y-2 text-sm">
							<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
								<dt class="text-muted-foreground">ID</dt>
								<dd><code>{p.id}</code></dd>
								<dt class="text-muted-foreground">Version</dt>
								<dd>{p.version ?? '–'}</dd>
							</dl>
							<p class={p.kind === 'broken' ? 'text-destructive' : 'text-muted-foreground'}>
								{p.reason}
							</p>
							{#if data.canInstall && p.kind === 'missing' && !p.enabled}
								<Button variant="outline" size="sm" onclick={() => openRemove(p.id, p.name, false)}>
									Daten löschen
								</Button>
							{/if}
						</Card.Content>
					</Card.Root>
				{/each}
			</div>
		</section>
	{/if}

	{#if !data.modules.length}
		<Card.Root>
			<Card.Content class="py-10 text-center text-muted-foreground">
				Es sind keine Module installiert.
			</Card.Content>
		</Card.Root>
	{/if}

	<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
		{#each data.modules as m (m.id)}
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex flex-wrap items-center gap-2">
						{m.name}
						{#if m.enabled}<Badge>Aktiv</Badge>{:else}<Badge variant="secondary">Inaktiv</Badge
							>{/if}
					</Card.Title>
					<Card.Description>{m.description || 'Keine Beschreibung'}</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-3 text-sm">
					<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
						<dt class="text-muted-foreground">ID</dt>
						<dd><code>{m.id}</code></dd>
						<dt class="text-muted-foreground">Version</dt>
						<dd>
							{m.version}
							{#if m.installedVersion && m.installedVersion !== m.version}
								<span class="text-muted-foreground">(installiert: {m.installedVersion})</span>
							{/if}
						</dd>
						<dt class="text-muted-foreground">Abhängigkeiten</dt>
						<dd>{m.dependencies.length ? m.dependencies.join(', ') : '–'}</dd>
						<dt class="text-muted-foreground">Berechtigungen</dt>
						<dd>{m.permissionCount}</dd>
						<dt class="text-muted-foreground">Herkunft</dt>
						<dd class="break-all">
							{#if data.origins[m.id]}
								{data.origins[m.id]!.label}{#if data.origins[m.id]!.commit}
									<code class="ml-1 text-xs text-muted-foreground"
										>{data.origins[m.id]!.commit!.slice(0, 7)}</code
									>{/if}
							{:else}
								im Build enthalten
							{/if}
						</dd>
					</dl>

					{#if m.missingDependencies.length}
						<p class="text-destructive" role="alert">
							Fehlende Module: {m.missingDependencies.join(', ')}
						</p>
					{/if}
					{#if m.dependents.length}
						<p class="text-muted-foreground">
							Benötigt von aktiven Modulen: {m.dependents.join(', ')}
						</p>
					{/if}
					{#if errors[m.id]}<p class="text-destructive" role="alert">{errors[m.id]}</p>{/if}

					<div class="flex flex-wrap items-center gap-2">
						{#if data.canManage}
							<form
								method="POST"
								action={m.enabled ? '?/disable' : '?/enable'}
								use:enhance={handler(m.id)}
							>
								<input type="hidden" name="id" value={m.id} />
								<Button
									type="submit"
									variant={m.enabled ? 'outline' : 'default'}
									disabled={busyId === m.id || (m.enabled && m.dependents.length > 0)}
								>
									{busyId === m.id ? 'Bitte warten …' : m.enabled ? 'Deaktivieren' : 'Aktivieren'}
								</Button>
							</form>
						{/if}
						{#if data.canInstall && !m.enabled && !m.requiredBy.length}
							<Button variant="ghost" onclick={() => openRemove(m.id, m.name, true)}>
								Entfernen …
							</Button>
						{/if}
					</div>
					{#if data.canInstall && !m.enabled && m.requiredBy.length}
						<p class="text-xs text-muted-foreground">
							Entfernen erst möglich, wenn {m.requiredBy.join(', ')} entfernt ist.
						</p>
					{/if}
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
</div>

<Dialog.Root open={!!removeTarget} onOpenChange={(o) => !o && (removeTarget = null)}>
	<Dialog.Content class="sm:max-w-lg">
		{#if removeTarget}
			<Dialog.Header>
				<Dialog.Title>
					{removeTarget.hasCode
						? `${removeTarget.name} entfernen`
						: `Daten von ${removeTarget.name} löschen`}
				</Dialog.Title>
				<Dialog.Description>
					{#if removeTarget.hasCode}
						Das Modul wird aus dem Server entfernt{data.installStatus.mode === 'supervisor'
							? ' (Neubau und Neustart)'
							: ''}. Ohne „Daten löschen“ bleiben Tabellen, Einstellungen und Dateien erhalten und
						sind nach einer erneuten Installation wieder da.
					{:else}
						Löscht alle Daten des nicht mehr installierten Moduls endgültig.
					{/if}
				</Dialog.Description>
			</Dialog.Header>
			<form
				method="POST"
				action="?/uninstall"
				use:enhance={action(() => (removeTarget = null))}
				class="space-y-4"
			>
				<input type="hidden" name="id" value={removeTarget.id} />
				{#if removeTarget.hasCode}
					<div class="flex items-start gap-2">
						<Checkbox
							id="rm-delete"
							name="deleteData"
							checked={deleteData}
							onCheckedChange={(v) => (deleteData = v === true)}
						/>
						<Label for="rm-delete" class="leading-snug">
							Daten löschen (Tabellen, Einstellungen, Rechte, Dateien) – nicht rückgängig zu machen
						</Label>
					</div>
				{:else}
					<input type="hidden" name="deleteData" value="on" />
				{/if}
				{#if deleteData}
					<FormField
						label="Zur Bestätigung die Modul-ID eingeben: {removeTarget.id}"
						id="rm-confirm"
						error={fields.confirmId}
					>
						<Input
							id="rm-confirm"
							name="confirmId"
							bind:value={confirmId}
							autocomplete="off"
							class="font-mono"
						/>
					</FormField>
				{/if}
				<AccountFields
					idPrefix="rm"
					bind:password
					bind:totp
					twoFactorEnabled={data.twoFactorEnabled}
					disabled={working}
					errors={fields}
				/>
				<input type="hidden" name="password" value={password} />
				<input type="hidden" name="totp" value={totp} />
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (removeTarget = null)}>
						Abbrechen
					</Button>
					<Button
						type="submit"
						variant="destructive-solid"
						disabled={working || !password || (deleteData && confirmId !== removeTarget.id)}
					>
						{working ? 'Bitte warten …' : deleteData ? 'Löschen' : 'Entfernen'}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
