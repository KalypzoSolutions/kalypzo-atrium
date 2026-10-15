<script lang="ts">
	import { enhance } from '$app/forms';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { submitHandler } from '../settings/form-utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busyId = $state<string | null>(null);
	let errors = $state<Record<string, string>>({});

	function handler(id: string) {
		return submitHandler({
			busy: (b) => (busyId = b ? id : null),
			error: (m) => (errors = { ...errors, [id]: m })
		});
	}
</script>

<svelte:head><title>Module</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-semibold">Module</h1>
		<p class="text-sm text-muted-foreground">
			Im Build enthaltene Module. Aktivierte Module erscheinen in der Navigation und der API.
		</p>
	</div>

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
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
</div>
