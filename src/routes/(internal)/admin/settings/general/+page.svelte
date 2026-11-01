<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import * as Card from '$lib/components/ui/card';
	import { t } from '$lib/i18n';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const filled = (key: string) => {
		const v = data.fields.find((f) => f.key === key)?.value;
		return typeof v === 'string' && v.trim() !== '';
	};
	/** Fehlen beide Links, zeigen Login und öffentliche Seiten keine Fußzeile */
	const missingLegal = $derived(
		[
			!filled('core.legal.imprintUrl') && t('admin-settings.general.imprint'),
			!filled('core.legal.privacyUrl') && t('admin-settings.general.privacy')
		].filter(Boolean) as string[]
	);
</script>

<PageTitle title={t('admin-settings.general.pageTitle')} />

<div class="space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>{t('admin-settings.general.systemTitle')}</Card.Title>
			<Card.Description>
				{t('admin-settings.general.systemDescription')}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if missingLegal.length}
				<Alert variant="info">
					<AlertDescription>
						{t('admin-settings.general.missingLegal', {
							links: missingLegal.join(t('admin-settings.general.and'))
						})}
					</AlertDescription>
				</Alert>
			{/if}
			<SettingsForm fields={data.fields} canEdit={data.canEdit} />
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>{t('admin-settings.general.retentionTitle')}</Card.Title>
			<Card.Description>
				{t('admin-settings.general.retentionDescription')}
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<SettingsForm fields={data.retentionFields} canEdit={data.canEdit} />
		</Card.Content>
	</Card.Root>
</div>
