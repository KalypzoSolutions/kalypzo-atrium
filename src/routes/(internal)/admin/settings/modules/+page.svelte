<script lang="ts">
	import { EmptyState, PageTitle } from '$lib/components/layout';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { t } from '$lib/i18n';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title={t('admin-settings.modules.pageTitle')} />

{#if data.modules.length === 0}
	<EmptyState
		title={t('admin-settings.modules.emptyTitle')}
		description={t('admin-settings.modules.emptyDescription')}
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
								{t('admin-settings.modules.ownPage')}
							{:else}
								{t('admin-settings.modules.ownPageNoAccess')}
							{/if}
						</p>
						{#if m.ownPage.canOpen}
							<Button href={m.ownPage.href} variant="outline">
								{t('admin-settings.modules.openOwnPage', { name: m.name })}
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
