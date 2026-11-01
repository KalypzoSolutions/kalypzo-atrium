<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import * as Card from '$lib/components/ui/card';
	import { t } from '$lib/i18n';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import TestMailCard from '../../_shared/TestMailCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title={t('admin-settings.mail.pageTitle')} />

<Card.Root>
	<Card.Header>
		<Card.Title>{t('admin-settings.mail.title')}</Card.Title>
		<Card.Description>
			{t('admin-settings.mail.description')}
		</Card.Description>
	</Card.Header>
	<Card.Content>
		<SettingsForm fields={data.fields} canEdit={data.canEdit} />
	</Card.Content>
</Card.Root>

{#if data.canEdit}
	<TestMailCard email={data.email} />
{/if}
