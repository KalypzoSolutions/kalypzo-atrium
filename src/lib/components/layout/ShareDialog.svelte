<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import SharePanel from './SharePanel.svelte';
	import type { ShareCandidate, ShareEntry, ShareLevel, ShareOwner } from './share-types';

	/**
	 * Freigabe als Dialog: Benutzer suchen, mit einer Stufe (z. B. Lesen/Bearbeiten)
	 * hinzufuegen, Stufe aendern oder entfernen. Die Persistenz liegt bei der aufrufenden Seite
	 * (`onadd`/`onchange`/`onremove`). Siehe `ShareMenu` fuer die Popover-Variante.
	 */
	let {
		open = $bindable(false),
		title = 'Freigeben',
		description = 'Gib diesen Eintrag für weitere Benutzer frei.',
		shares,
		owner,
		levels,
		defaultLevel,
		canManage = true,
		search,
		onadd,
		onchange,
		onremove
	}: {
		open?: boolean;
		title?: string;
		description?: string;
		shares: ShareEntry[];
		owner?: ShareOwner;
		levels: ShareLevel[];
		defaultLevel?: string;
		canManage?: boolean;
		search: (query: string) => Promise<ShareCandidate[]>;
		onadd: (user: ShareCandidate, level: string) => Promise<void>;
		onchange: (userId: string, level: string) => Promise<void>;
		onremove: (userId: string) => Promise<void>;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>

		<SharePanel
			{shares}
			{owner}
			{levels}
			{defaultLevel}
			{canManage}
			{search}
			{onadd}
			{onchange}
			{onremove}
		/>

		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (open = false)}>Schließen</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
