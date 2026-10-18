<script lang="ts">
	import { METHOD_BADGE_CLASS } from '$lib/api-docs/method-style';
	import Copy from '@lucide/svelte/icons/copy';
	import { toast } from 'svelte-sonner';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { SummaryList, type SummaryRow } from '$lib/components/layout';
	import { cn } from '$lib/utils';
	import type { ApiCatalogEntry, JsonSchema } from '$lib/api-docs/types';
	import SchemaTree from './SchemaTree.svelte';
	import ResponsePanel from './ResponsePanel.svelte';
	import ErrorsTable from './ErrorsTable.svelte';
	import ApiConsole from './ApiConsole.svelte';

	let { entry, open = $bindable(false) }: { entry: ApiCatalogEntry | null; open: boolean } =
		$props();

	function formatBytes(bytes: number): string {
		if (bytes >= 1024 * 1024) {
			const mb = bytes / (1024 * 1024);
			return `${mb.toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
		}
		if (bytes >= 1024) return `${Math.round(bytes / 1024).toLocaleString('de-DE')} KB`;
		return `${bytes.toLocaleString('de-DE')} Byte`;
	}

	function accessText(e: ApiCatalogEntry): string {
		if (e.access === 'public') return 'Öffentlich';
		if (e.access === 'authenticated') return 'Nur Anmeldung';
		return `Berechtigung ${e.permission ?? '–'}`;
	}

	function overviewRows(e: ApiCatalogEntry): SummaryRow[] {
		const rl = e.rateLimit;
		const rows: SummaryRow[] = [
			{ label: 'Modul', value: e.moduleEnabled ? e.moduleName : `${e.moduleName} (inaktiv)` },
			{ label: 'Zugriff', value: accessText(e) },
			{
				label: 'Nur Session',
				value: e.sessionOnly ? 'Ja' : 'Nein',
				hint: 'Nur mit angemeldeter Sitzung aufrufbar, nicht per API-Schlüssel.'
			},
			{
				label: 'Für dich aufrufbar',
				value: e.allowed ? 'Ja' : e.moduleEnabled ? 'Nein' : 'Nein (Modul inaktiv)'
			},
			{
				label: 'Rate-Limit',
				value: `${rl.limit.toLocaleString('de-DE')} Anfragen / ${rl.windowSec.toLocaleString('de-DE')} s${rl.isDefault ? ' (Standard)' : ''}`
			}
		];
		if (e.multipart) {
			rows.push({
				label: 'Datei-Upload',
				value: `max. ${e.multipart.maxFiles} ${e.multipart.maxFiles === 1 ? 'Datei' : 'Dateien'}, ${formatBytes(e.multipart.maxBytes)}`
			});
		}
		rows.push({ label: 'Erfolgsstatus', value: String(e.successStatus) });
		return rows;
	}

	const requestSections = (
		e: ApiCatalogEntry
	): { title: string; schema: JsonSchema | null; empty: string }[] => [
		{ title: 'Pfadparameter', schema: e.params, empty: 'Keine Pfadparameter' },
		{ title: 'Query-Parameter', schema: e.query, empty: 'Keine Query-Parameter' },
		{ title: 'Body', schema: e.body, empty: 'Kein Body' }
	];

	async function copyPath(path: string) {
		try {
			await navigator.clipboard.writeText(path);
			toast.success('Pfad kopiert');
		} catch {
			toast.error('Kopieren nicht möglich');
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		side="right"
		class="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
	>
		{#if entry}
			{#key entry.id}
				<Sheet.Header class="border-b pr-12">
					<div class="flex items-start gap-2">
						<span
							class={cn(
								'mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-xs font-semibold',
								METHOD_BADGE_CLASS[entry.method]
							)}
						>
							{entry.method}
						</span>
						<Sheet.Title class="min-w-0 flex-1 font-mono text-sm leading-6 break-all">
							{entry.path}
						</Sheet.Title>
						<Button
							variant="ghost"
							size="icon-sm"
							class="shrink-0"
							aria-label="Pfad kopieren"
							title="Pfad kopieren"
							onclick={() => copyPath(entry.path)}
						>
							<Copy />
						</Button>
					</div>
					<Sheet.Description>{entry.summary}</Sheet.Description>
				</Sheet.Header>

				<div class="p-4">
					<Tabs.Root value="overview">
						<Tabs.List variant="line">
							<Tabs.Trigger value="overview">Übersicht</Tabs.Trigger>
							<Tabs.Trigger value="request">Anfrage</Tabs.Trigger>
							<Tabs.Trigger value="response">Antwort</Tabs.Trigger>
							<Tabs.Trigger value="errors">Fehler</Tabs.Trigger>
							<Tabs.Trigger value="try">Ausprobieren</Tabs.Trigger>
						</Tabs.List>

						<Tabs.Content value="overview" class="space-y-4 pt-2">
							<SummaryList rows={overviewRows(entry)} />
							{#if entry.description}
								<p class="text-muted-foreground text-sm whitespace-pre-line">
									{entry.description}
								</p>
							{/if}
						</Tabs.Content>

						<Tabs.Content value="request" class="space-y-5 pt-2">
							{#each requestSections(entry) as section (section.title)}
								<section class="space-y-2">
									<h3 class="text-sm font-semibold">{section.title}</h3>
									{#if section.schema}
										<SchemaTree schema={section.schema} emptyText="Keine" />
									{:else}
										<p class="text-muted-foreground text-sm">Keine</p>
									{/if}
								</section>
							{/each}
						</Tabs.Content>

						<Tabs.Content value="response" class="pt-2">
							<ResponsePanel {entry} />
						</Tabs.Content>

						<Tabs.Content value="errors" class="pt-2">
							<ErrorsTable errors={entry.errors} />
						</Tabs.Content>

						<Tabs.Content value="try" class="pt-2">
							<ApiConsole {entry} />
						</Tabs.Content>
					</Tabs.Root>
				</div>
			{/key}
		{:else}
			<Sheet.Header>
				<Sheet.Title>Kein Endpunkt gewählt</Sheet.Title>
			</Sheet.Header>
		{/if}
	</Sheet.Content>
</Sheet.Root>
