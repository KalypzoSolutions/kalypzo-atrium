<script lang="ts">
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Info from '@lucide/svelte/icons/info';
	import Copy from '@lucide/svelte/icons/copy';
	import Send from '@lucide/svelte/icons/send';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Badge } from '$lib/components/ui/badge';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { ConfirmDialog, FormField } from '$lib/components/layout';
	import type {
		ApiCatalogEntry,
		ConsoleRequestInput,
		ConsoleResult,
		JsonSchema
	} from '$lib/api-docs/types';
	import {
		buildConsoleRequest,
		buildCurl,
		isMutating,
		pathParamNames,
		readConsoleResult
	} from '$lib/api-docs/console';
	import { exampleJson } from '$lib/api-docs/example';

	let { entry }: { entry: ApiCatalogEntry } = $props();

	const TIMEOUT_MS = 30_000;

	// Der Elternteil nutzt {#key entry.id}: der Zustand wird je Eintrag frisch angelegt.
	// svelte-ignore state_referenced_locally
	const initial = entry;
	const paramNames = pathParamNames(initial.path);
	const queryProps: [string, JsonSchema][] = Object.entries(initial.query?.properties ?? {});
	const queryRequired = new Set(initial.query?.required ?? []);
	const paramProps = initial.params?.properties ?? {};
	const hasBody = initial.body !== null && initial.method !== 'GET';
	const mutating = isMutating(initial.method);
	const idBase = `console-${initial.id.replace(/[^a-zA-Z0-9]+/g, '-')}`;

	function exampleBody(): string {
		return initial.body ? exampleJson(initial.body, { requiredOnly: true }) : '';
	}

	function placeholderFor(schema: JsonSchema | undefined): string {
		if (!schema) return '';
		const candidate =
			schema.examples?.[0] ?? schema.default ?? schema.const ?? schema.enum?.[0] ?? undefined;
		if (candidate === undefined || candidate === null) return '';
		return typeof candidate === 'string' ? candidate : JSON.stringify(candidate);
	}

	let params = $state<Record<string, string>>(Object.fromEntries(paramNames.map((n) => [n, ''])));
	let query = $state<Record<string, string>>(Object.fromEntries(queryProps.map(([n]) => [n, ''])));
	let bodyText = $state(hasBody ? exampleBody() : '');

	let fieldErrors = $state<Record<string, string>>({});
	let generalError = $state<string | null>(null);
	let busy = $state(false);
	let confirmOpen = $state(false);
	let result = $state<ConsoleResult | null>(null);
	let networkError = $state<string | null>(null);
	let showCurl = $state(false);

	let controller: AbortController | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let timedOut = false;

	const input = $derived<ConsoleRequestInput>({
		method: initial.method,
		path: initial.path,
		params: { ...params },
		query: { ...query },
		bodyText: hasBody ? bodyText : ''
	});
	const curl = $derived(buildCurl(input, page.url.origin));

	const statusVariant = $derived.by(() => {
		const s = result?.status ?? 0;
		if (s >= 200 && s < 300)
			return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
		if (s >= 400 && s < 500)
			return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400';
		if (s >= 500) return 'border-destructive/40 bg-destructive/10 text-destructive';
		return 'border-border bg-muted text-foreground';
	});

	/** Ordnet `field` aus dem Build einem Eingabefeld zu (`body`, `params.x`, `query.x` oder nur `x`). */
	function errorKey(field: string | undefined): string | null {
		if (!field) return null;
		if (field === 'body' || field.startsWith('body.')) return hasBody ? 'body' : null;
		if (field.startsWith('param:')) {
			const name = field.slice('param:'.length);
			return paramNames.includes(name) ? `params.${name}` : null;
		}
		const [prefix, ...rest] = field.split('.');
		const name = rest.length > 0 ? rest.join('.') : prefix!;
		if ((prefix === 'params' || rest.length === 0) && paramNames.includes(name))
			return `params.${name}`;
		if ((prefix === 'query' || rest.length === 0) && name in query) return `query.${name}`;
		return null;
	}

	function clearTimer() {
		if (timer) clearTimeout(timer);
		timer = null;
	}

	function requestSend() {
		if (initial.multipart || busy) return;
		fieldErrors = {};
		generalError = null;
		const build = buildConsoleRequest(input);
		if (!build.ok) {
			const key = errorKey(build.field);
			if (key) fieldErrors = { [key]: build.error };
			else generalError = build.error;
			return;
		}
		if (mutating) confirmOpen = true;
		else void send();
	}

	async function send() {
		const build = buildConsoleRequest(input);
		if (!build.ok) {
			const key = errorKey(build.field);
			if (key) fieldErrors = { [key]: build.error };
			else generalError = build.error;
			return;
		}
		busy = true;
		result = null;
		networkError = null;
		timedOut = false;
		controller = new AbortController();
		timer = setTimeout(() => {
			timedOut = true;
			controller?.abort();
		}, TIMEOUT_MS);
		const startedAt = Date.now();
		try {
			const res = await fetch(build.url, {
				redirect: 'error',
				...build.init,
				credentials: 'same-origin',
				signal: controller.signal
			});
			result = await readConsoleResult(res, startedAt);
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				networkError = timedOut
					? 'Zeitüberschreitung: keine Antwort innerhalb von 30 Sekunden.'
					: 'Anfrage abgebrochen.';
			} else {
				networkError =
					err instanceof Error && err.message
						? `Netzwerkfehler: ${err.message}`
						: 'Netzwerkfehler: Der Server ist nicht erreichbar.';
			}
		} finally {
			clearTimer();
			controller = null;
			busy = false;
		}
	}

	function abort() {
		controller?.abort();
	}

	async function copy(text: string, what: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(`${what} kopiert.`);
		} catch {
			toast.error('Kopieren nicht möglich.');
		}
	}

	onDestroy(() => {
		clearTimer();
		controller?.abort();
	});
</script>

<div class="grid gap-4">
	{#if initial.multipart}
		<Alert>
			<Info aria-hidden="true" />
			<AlertDescription>Multipart-Uploads lassen sich hier nicht ausprobieren.</AlertDescription>
		</Alert>
	{:else}
		{#if mutating}
			<Alert
				class="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 *:data-[slot=alert-description]:text-amber-800 dark:*:data-[slot=alert-description]:text-amber-300"
			>
				<TriangleAlert aria-hidden="true" />
				<AlertDescription>
					Anfragen laufen mit deiner Anmeldung und deinen Rechten. Schreibende Anfragen ändern echte
					Daten.
				</AlertDescription>
			</Alert>
		{:else}
			<p class="text-xs text-muted-foreground">
				Anfragen laufen mit deiner Anmeldung und deinen Rechten. Schreibende Anfragen ändern echte
				Daten.
			</p>
		{/if}

		{#if !initial.moduleEnabled}
			<Alert>
				<Info aria-hidden="true" />
				<AlertDescription>
					Das Modul „{initial.moduleName}“ ist nicht aktiv – die Anfrage wird mit 404 abgelehnt.
				</AlertDescription>
			</Alert>
		{/if}
		{#if !initial.allowed && initial.permission && initial.moduleEnabled}
			<Alert>
				<Info aria-hidden="true" />
				<AlertDescription>
					Dir fehlt das Recht <code class="font-mono text-xs">{initial.permission}</code> – die Anfrage
					wird mit 403 abgelehnt.
				</AlertDescription>
			</Alert>
		{/if}

		<form
			class="grid gap-4"
			onsubmit={(e) => {
				e.preventDefault();
				requestSend();
			}}
		>
			{#if paramNames.length > 0}
				<fieldset class="grid gap-3">
					<legend class="mb-1 text-sm font-medium">Pfadparameter</legend>
					{#each paramNames as name (name)}
						{@const id = `${idBase}-param-${name}`}
						{@const err = fieldErrors[`params.${name}`]}
						<FormField label={`${name} *`} {id} error={err}>
							<Input
								{id}
								bind:value={params[name]}
								placeholder={placeholderFor(paramProps[name])}
								required
								autocomplete="off"
								aria-invalid={err ? 'true' : undefined}
								aria-describedby={err ? `${id}-error` : undefined}
							/>
						</FormField>
					{/each}
				</fieldset>
			{/if}

			{#if queryProps.length > 0}
				<fieldset class="grid gap-3">
					<legend class="mb-1 text-sm font-medium">Query-Parameter</legend>
					{#each queryProps as [name, schema] (name)}
						{@const id = `${idBase}-query-${name}`}
						{@const err = fieldErrors[`query.${name}`]}
						<FormField
							label={queryRequired.has(name) ? `${name} *` : name}
							{id}
							error={err}
							hint={schema.description}
						>
							<Input
								{id}
								bind:value={query[name]}
								placeholder={placeholderFor(schema)}
								autocomplete="off"
								aria-invalid={err ? 'true' : undefined}
								aria-describedby={err
									? `${id}-error`
									: schema.description
										? `${id}-hint`
										: undefined}
							/>
						</FormField>
					{/each}
				</fieldset>
			{/if}

			{#if hasBody}
				{@const id = `${idBase}-body`}
				{@const err = fieldErrors['body']}
				<div class="grid gap-1.5">
					<div class="flex items-center justify-between gap-2">
						<label for={id} class="text-sm font-medium">Body (JSON)</label>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onclick={() => {
								bodyText = exampleBody();
								fieldErrors = {};
							}}
						>
							Beispiel einsetzen
						</Button>
					</div>
					<Textarea
						{id}
						bind:value={bodyText}
						rows={8}
						spellcheck={false}
						class="max-h-80 font-mono text-xs"
						aria-invalid={err ? 'true' : undefined}
						aria-describedby={err ? `${id}-error` : undefined}
					/>
					{#if err}<p id="{id}-error" role="alert" class="text-xs text-destructive">{err}</p>{/if}
				</div>
			{/if}

			{#if generalError}
				<p role="alert" class="text-xs text-destructive">{generalError}</p>
			{/if}

			<div class="flex flex-wrap items-center gap-2">
				<Button type="submit" disabled={busy}>
					<Send aria-hidden="true" />
					{busy ? 'Sendet …' : 'Senden'}
				</Button>
				{#if busy}
					<Button type="button" variant="outline" onclick={abort}>Abbrechen</Button>
				{/if}
				<span class="font-mono text-xs text-muted-foreground">
					{initial.method}
					{initial.path}
				</span>
			</div>
		</form>

		{#if networkError}
			<Alert variant="destructive">
				<WifiOff aria-hidden="true" />
				<AlertDescription>{networkError}</AlertDescription>
			</Alert>
		{/if}

		{#if result}
			{@const res = result}
			<section class="grid gap-2 rounded-lg border p-3" aria-label="Antwort" aria-live="polite">
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
					<Badge variant="outline" class={statusVariant}>{res.status}</Badge>
					<span class="text-muted-foreground">{Math.round(res.durationMs)} ms</span>
					{#if res.rateLimitRemaining !== null}
						<span class="text-muted-foreground">Rate-Limit-Rest: {res.rateLimitRemaining}</span>
					{/if}
					{#if res.requestId}
						<span class="flex items-center gap-1 text-muted-foreground">
							Request-ID:
							<code class="font-mono">{res.requestId}</code>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="Request-ID kopieren"
								onclick={() => copy(res.requestId ?? '', 'Request-ID')}
							>
								<Copy aria-hidden="true" />
							</Button>
						</span>
					{/if}
				</div>
				<div class="relative">
					<pre
						class="max-h-96 overflow-auto rounded-md bg-muted p-3 pr-10 font-mono text-xs break-words whitespace-pre-wrap">{res.bodyText ||
							'(leerer Body)'}</pre>
					{#if res.bodyText}
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							class="absolute top-1.5 right-1.5"
							aria-label="Antwort kopieren"
							onclick={() => copy(res.bodyText, 'Antwort')}
						>
							<Copy aria-hidden="true" />
						</Button>
					{/if}
				</div>
			</section>
		{/if}

		<div class="grid gap-2">
			<button
				type="button"
				class="flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
				aria-expanded={showCurl}
				onclick={() => (showCurl = !showCurl)}
			>
				<ChevronRight
					class="size-4 transition-transform {showCurl ? 'rotate-90' : ''}"
					aria-hidden="true"
				/>
				curl-Befehl
			</button>
			{#if showCurl && !curl}
				<p class="text-xs text-muted-foreground">
					Fülle zuerst die Pflichtfelder aus und prüfe den Body – dann erscheint hier der Befehl.
				</p>
			{:else if showCurl}
				<p class="text-xs text-muted-foreground">
					Für Skripte mit einem API-Key statt deiner Anmeldung (<code class="font-mono"
						>$EPK_KEY</code
					>).
				</p>
				<div class="relative">
					<pre
						class="max-h-60 overflow-auto rounded-md bg-muted p-3 pr-10 font-mono text-xs break-all whitespace-pre-wrap">{curl}</pre>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						class="absolute top-1.5 right-1.5"
						aria-label="curl-Befehl kopieren"
						onclick={() => copy(curl, 'curl-Befehl')}
					>
						<Copy aria-hidden="true" />
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title={`${initial.method} ${initial.path} wirklich ausführen?`}
	description="Die Anfrage läuft mit deiner Anmeldung und ändert echte Daten."
	confirmLabel="Ausführen"
	destructive={initial.method === 'DELETE'}
	onconfirm={send}
/>
