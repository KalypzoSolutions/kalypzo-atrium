<script lang="ts">
	import type { ModulePageProps } from '$lib/sdk/types/module-ui';

	let { params }: ModulePageProps = $props();
</script>

<section class="p-4" data-testid="fx-board-note">
	<h1 class="text-title">Eintrag {params.id}</h1>
</section>
