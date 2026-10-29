<script lang="ts">
	import { DataTable, PageTitle } from '$lib/components/layout';
	import * as Alert from '$lib/components/ui/alert';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import SettingsForm from '../../_shared/SettingsForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const nf = new Intl.NumberFormat('de-DE');
	const usd = new Intl.NumberFormat('de-DE', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 4
	});
	const month = new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

	/** Einstellungen der Schreibhilfe (Stil, heikle Daten, Limit je Person) eigene Karte */
	const isAssistKey = (key: string) =>
		key.startsWith('core.ai.style.') ||
		key.startsWith('core.ai.assist.') ||
		key === 'core.ai.userMonthlyTokenLimit';
	const configFields = $derived(data.fields.filter((f) => !isAssistKey(f.key)));
	const assistFields = $derived(data.fields.filter((f) => isAssistKey(f.key)));
</script>

<PageTitle title="KI · Einstellungen" />

<div class="space-y-6">
	<p class="text-sm text-muted-foreground">
		KI-Dienst (OpenAI): zentrale Konfiguration und Verbrauch aller Module.
	</p>

	<!-- #69: Übermittlung an Dritte -->
	<Alert.Root variant="warning">
		<Alert.Title>Datenschutz: Übermittlung an einen externen Dienst</Alert.Title>
		<Alert.Description>
			<p>
				Alles, was Module an die KI schicken, geht an den eingetragenen Anbieter (Basis-URL) – ggf.
				außerhalb der EU. Vor dem Einschalten ist ein Auftragsverarbeitungsvertrag (AV-Vertrag) mit
				dem Anbieter nötig; bei Drittländern zusätzlich eine Grundlage für die Übermittlung.
			</p>
			<p>
				Keine Gesundheitsdaten, keine Daten von Kindern und keine Kontaktdaten senden; Namen
				möglichst durch Platzhalter ersetzen. Gespeichert werden hier nur Zähler (Anfragen, Tokens,
				Kosten), keine Inhalte.
			</p>
		</Alert.Description>
	</Alert.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Nutzung im {month}</Card.Title>
			<Card.Description>
				Kosten sind Schätzungen auf Basis der hinterlegten Preise.
				{#if data.limits.tokens > 0}Token-Limit je Modul: {nf.format(data.limits.tokens)}.{/if}
				{#if data.limits.costUsd > 0}Kostenlimit je Modul: {usd.format(data.limits.costUsd)}.{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<div>
					<dt class="text-xs text-muted-foreground">Anfragen</dt>
					<dd class="text-xl font-semibold">{nf.format(data.totals.requests)}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Eingabe-Tokens</dt>
					<dd class="text-xl font-semibold">{nf.format(data.totals.inputTokens)}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Ausgabe-Tokens</dt>
					<dd class="text-xl font-semibold">{nf.format(data.totals.outputTokens)}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Geschätzte Kosten</dt>
					<dd class="text-xl font-semibold">{usd.format(data.totals.costUsd)}</dd>
				</div>
			</dl>
		</Card.Content>
	</Card.Root>

	<DataTable
		caption="KI-Nutzung je Modul"
		title="Nutzung je Modul"
		empty={data.usage.length === 0}
		emptyTitle="In diesem Monat wurde der KI-Dienst noch nicht genutzt."
	>
		{#snippet head()}
			<Table.Row>
				<Table.Head>Modul</Table.Head>
				<Table.Head>Modell</Table.Head>
				<Table.Head class="text-right">Anfragen</Table.Head>
				<Table.Head class="text-right">Eingabe</Table.Head>
				<Table.Head class="text-right">Ausgabe</Table.Head>
				<Table.Head class="text-right">Kosten</Table.Head>
			</Table.Row>
		{/snippet}
		{#each data.usage as r (r.moduleId + r.model)}
			<Table.Row>
				<Table.Cell class="font-medium">{r.moduleId}</Table.Cell>
				<Table.Cell>{r.model}</Table.Cell>
				<Table.Cell class="text-right">{nf.format(r.requests)}</Table.Cell>
				<Table.Cell class="text-right">{nf.format(r.inputTokens)}</Table.Cell>
				<Table.Cell class="text-right">{nf.format(r.outputTokens)}</Table.Cell>
				<Table.Cell class="text-right">{usd.format(r.costUsd)}</Table.Cell>
			</Table.Row>
		{/each}
	</DataTable>

	{#if data.canManage}
		<Card.Root>
			<Card.Header>
				<Card.Title>Konfiguration</Card.Title>
				<Card.Description>
					Der API-Key wird verschlüsselt gespeichert und nie an den Browser übertragen.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<SettingsForm fields={configFields} canEdit={true} />
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Schreibhilfe</Card.Title>
				<Card.Description>
					Vorschläge für Texte in Nachrichten, Aktionen, Terminen, Website und weiteren Modulen. Wer
					sie nutzen darf, steuert das Recht „KI-Schreibhilfe“ des jeweiligen Moduls (Rollen).
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<Alert.Root variant="info">
					<Alert.Description>
						Die Schreibhilfe schickt den Text im Feld und Eckdaten (z. B. Datum, Ort und Beitrag
						einer Aktion) an den Anbieter, nie Empfängerlisten, Teilnehmende oder Gesundheitsdaten.
						E-Mail-Adressen, Telefonnummern und IBANs werden vorher maskiert. Bitte einen Absatz zur
						Schreibhilfe in die Datenschutzerklärung aufnehmen.
					</Alert.Description>
				</Alert.Root>
				<SettingsForm fields={assistFields} canEdit={true} />
			</Card.Content>
		</Card.Root>
	{/if}
</div>
