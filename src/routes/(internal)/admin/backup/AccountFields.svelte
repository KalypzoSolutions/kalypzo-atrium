<!-- Konto-Passwort und (bei aktiver 2FA) Authenticator-Code zur Bestätigung -->
<script lang="ts">
	import { t } from '$lib/i18n';
	import { FormField } from '$lib/components/layout';
	import { Input } from '$lib/components/ui/input';

	let {
		idPrefix,
		password = $bindable(''),
		totp = $bindable(''),
		twoFactorEnabled,
		disabled = false,
		errors = {}
	}: {
		idPrefix: string;
		password?: string;
		totp?: string;
		twoFactorEnabled: boolean;
		disabled?: boolean;
		errors?: Record<string, string>;
	} = $props();
</script>

<FormField
	label={t('admin-backup.account.password')}
	id="{idPrefix}-password"
	error={errors.password}
>
	<Input
		id="{idPrefix}-password"
		type="password"
		autocomplete="current-password"
		bind:value={password}
		{disabled}
		required
		aria-invalid={errors.password ? true : undefined}
		aria-describedby={errors.password ? `${idPrefix}-password-error` : undefined}
	/>
</FormField>
{#if twoFactorEnabled}
	<FormField
		label={t('admin-backup.account.totp')}
		id="{idPrefix}-totp"
		error={errors.totp}
		hint={t('admin-backup.account.totpHint')}
	>
		<Input
			id="{idPrefix}-totp"
			inputmode="numeric"
			autocomplete="one-time-code"
			maxlength={6}
			pattern="[0-9]{6}"
			bind:value={totp}
			{disabled}
			class="font-mono tracking-widest"
			required
			aria-invalid={errors.totp ? true : undefined}
			aria-describedby={errors.totp ? `${idPrefix}-totp-error` : `${idPrefix}-totp-hint`}
		/>
	</FormField>
{/if}
