<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { submitHandler } from './form-utils';

	/** Karte „Test-E-Mail“ – erwartet eine Action `testMail` auf der Seite. */
	let { email }: { email: string } = $props();

	let busy = $state(false);
	const handler = submitHandler({ busy: (b) => (busy = b), reload: false });
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Test-E-Mail</Card.Title>
		<Card.Description>
			Speichere zuerst deine Änderungen, dann sende eine Testnachricht.
		</Card.Description>
	</Card.Header>
	<Card.Content>
		<form
			method="POST"
			action="?/testMail"
			class="flex flex-wrap items-end gap-3"
			use:enhance={handler}
		>
			<div class="space-y-1.5">
				<Label for="to">Empfänger</Label>
				<Input id="to" name="to" type="email" required value={email} />
			</div>
			<Button type="submit" variant="outline" disabled={busy}>
				{busy ? 'Sendet …' : 'Test-E-Mail senden'}
			</Button>
		</form>
	</Card.Content>
</Card.Root>
