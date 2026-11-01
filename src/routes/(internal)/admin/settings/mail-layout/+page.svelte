<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { t } from '$lib/i18n';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import TestMailCard from '../../_shared/TestMailCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let previewKey = $state(0);
</script>

<PageTitle title={t('admin-mail.pageTitle')} />

<Card.Root>
	<Card.Header>
		<Card.Title>{t('admin-mail.layout.title')}</Card.Title>
		<Card.Description>{t('admin-mail.layout.description')}</Card.Description>
	</Card.Header>
	<Card.Content>
		<SettingsForm fields={data.fields} canEdit={data.canEdit} />
	</Card.Content>
</Card.Root>

<Card.Root>
	<Card.Header>
		<Card.Title>{t('admin-mail.preview.title')}</Card.Title>
		<Card.Description>{t('admin-mail.preview.description')}</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		<iframe
			title={t('admin-mail.preview.frameTitle')}
			src={`/admin/settings/mail-preview?v=${previewKey}`}
			class="h-[640px] w-full rounded-md border bg-muted/30"
			sandbox=""
		></iframe>
		<Button type="button" variant="outline" size="sm" onclick={() => (previewKey += 1)}>
			{t('admin-mail.preview.reload')}
		</Button>
	</Card.Content>
</Card.Root>

{#if data.canEdit}
	<TestMailCard email={data.email} />
{/if}
