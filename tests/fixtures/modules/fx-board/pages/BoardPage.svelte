<script lang="ts">
	import { PageHeader } from '$lib/components/layout';
	import * as Card from '$lib/components/ui/card';
	import type { ModulePageProps } from '$lib/sdk/types/module-ui';
	import colors from '../data/colors.json';

	let { path }: ModulePageProps = $props();
</script>

<div class="space-y-6">
	<PageHeader title="Pinnwand" description="Fixture-Seite für Core-Tests" />
	<!-- Eigene Tailwind-Klasse nur hier: beweist, dass das Modulverzeichnis als @source eingebunden ist -->
	<Card.Root class="min-h-[17.25rem]" data-testid="fx-board-page">
		<Card.Content>
			<p>Pfad: <code>{path || '/'}</code></p>
			<p>Farbe: {colors.default}</p>
		</Card.Content>
	</Card.Root>
</div>
