<script lang="ts">
	import { EmptyState, PageTitle } from '$lib/components/layout';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title="Module · Einstellungen" />

{#if data.modules.length === 0}
	<EmptyState
		title="Keine Modul-Einstellungen"
		description="Keines der aktiven Module bringt eigene Einstellungen mit. Module aktivierst du unter Administration → Module."
	/>
{:else}
	{#each data.modules as m (m.id)}
		<Card.Root>
			<Card.Header>
				<Card.Title>{m.name}</Card.Title>
				{#if m.description}<Card.Description>{m.description}</Card.Description>{/if}
			</Card.Header>
			<Card.Content>
				{#if m.ownPage}
					<div class="flex flex-wrap items-center justify-between gap-3">
						<p class="text-sm text-muted-foreground">
							{#if m.ownPage.canOpen}
								Dieses Modul hat eine eigene Einstellungsseite.
							{:else}
								Dieses Modul hat eine eigene Einstellungsseite. Dafür fehlt dir die Berechtigung.
							{/if}
						</p>
						{#if m.ownPage.canOpen}
							<Button href={m.ownPage.href} variant="outline">
								Zu den Einstellungen „{m.name}“
							</Button>
						{/if}
					</div>
				{:else}
					<SettingsForm fields={m.fields} canEdit={data.canEdit} />
				{/if}
			</Card.Content>
		</Card.Root>
	{/each}
{/if}
