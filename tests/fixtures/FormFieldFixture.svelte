<script lang="ts">
	import { FormField, MoneyInput, NumberStepper } from '$lib/components/layout';
	import { Input } from '$lib/components/ui/input';
	import { SelectField } from '$lib/components/ui/select-field';
	import { Textarea } from '$lib/components/ui/textarea';

	let {
		control,
		error = null,
		hint,
		required = false,
		ownDescribedby,
		ownInvalid
	}: {
		control: 'input' | 'textarea' | 'select' | 'money' | 'stepper' | 'two-inputs';
		error?: string | null;
		hint?: string;
		required?: boolean;
		ownDescribedby?: string;
		ownInvalid?: boolean;
	} = $props();
</script>

<FormField label="Betrag" id="f-amount" {error} {hint} {required}>
	{#if control === 'input'}
		<Input id="f-amount" aria-describedby={ownDescribedby} aria-invalid={ownInvalid} />
	{:else if control === 'textarea'}
		<Textarea id="f-amount" />
	{:else if control === 'select'}
		<SelectField id="f-amount" label="Betrag" options={[{ value: 'a', label: 'A' }]} />
	{:else if control === 'money'}
		<MoneyInput id="f-amount" label="Betrag" />
	{:else if control === 'stepper'}
		<NumberStepper id="f-amount" label="Betrag" value={1} />
	{:else}
		<Input id="f-amount" />
		<Input id="f-other" />
	{/if}
</FormField>
<Input id="outside" />
