<script lang="ts">
	import { PageTitle } from '$lib/components/layout';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Label } from '$lib/components/ui/label';
	import { SelectField } from '$lib/components/ui/select-field';
	import { t } from '$lib/i18n';
	import TemplateCard from './TemplateCard.svelte';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let template = $state<string | null>('default');
</script>

<PageTitle title={t('admin-pdf.pageTitle')} />

<div class="space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>{t('admin-pdf.settings.title')}</Card.Title>
			<Card.Description>
				{t('admin-pdf.settings.descriptionBefore')}<a
					href="/admin/settings/design"
					class="underline underline-offset-2 hover:text-foreground"
					>{t('admin-pdf.settings.designLink')}</a
				>{t('admin-pdf.settings.descriptionMiddle')}<a
					href="/admin/settings/general"
					class="underline underline-offset-2 hover:text-foreground"
					>{t('admin-pdf.settings.generalLink')}</a
				>{t('admin-pdf.settings.descriptionAfter')}
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<SettingsForm fields={data.fields} canEdit={true} />
		</Card.Content>
	</Card.Root>

	<section class="space-y-4">
		<div>
			<h2 class="text-section">{t('admin-pdf.templates.title')}</h2>
			<p class="text-sm text-muted-foreground">
				{t('admin-pdf.templates.descriptionBefore')}<code class="font-mono text-xs"
					>src/lib/server/core/pdf/templates/</code
				>{t('admin-pdf.templates.descriptionAfter')}
			</p>
		</div>
		<div class="grid gap-6 lg:grid-cols-2">
			{#each data.templateInfo as info (info.id)}
				<TemplateCard {info} />
			{/each}
		</div>
	</section>

	<Card.Root>
		<Card.Header>
			<Card.Title>{t('admin-pdf.test.title')}</Card.Title>
			<Card.Description>{t('admin-pdf.test.description')}</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="GET" action="/admin/settings/pdf/test" class="flex flex-wrap items-end gap-3">
				<div class="space-y-1.5">
					<Label for="tpl">{t('admin-pdf.test.template')}</Label>
					<SelectField
						id="tpl"
						name="template"
						label={t('admin-pdf.test.template')}
						options={data.templates.map((x) => ({ value: x.id, label: x.label }))}
						bind:value={template}
					/>
				</div>
				<Button type="submit">{t('admin-pdf.test.download')}</Button>
			</form>
		</Card.Content>
	</Card.Root>
</div>
