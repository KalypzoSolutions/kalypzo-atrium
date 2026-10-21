<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Menu from '@lucide/svelte/icons/menu';
	import SearchIcon from '@lucide/svelte/icons/search';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import UserIcon from '@lucide/svelte/icons/user';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuLabel,
		DropdownMenuRadioGroup,
		DropdownMenuRadioItem,
		DropdownMenuSeparator,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '$lib/components/ui/sheet';
	import { theme, type ThemeChoice } from '$lib/theme.svelte';
	import CommandPalette from './CommandPalette.svelte';
	import SidebarNav from './SidebarNav.svelte';
	import type { ModuleNavEntry } from './nav';

	let {
		user,
		systemName,
		permissions,
		navigation
	}: {
		user: { name: string; email: string; image?: string | null };
		systemName: string;
		permissions: string[];
		navigation: ModuleNavEntry[];
	} = $props();

	let menuOpen = $state(false);
	const THEME_LABELS: Record<ThemeChoice, string> = {
		light: 'Hell',
		dark: 'Dunkel',
		system: 'System'
	};
	let paletteOpen = $state(false);
	/** Nur eigene Profilbilder (`/avatar/…`) anzeigen, keine fremden Adressen aus alten Daten */
	const avatarSrc = $derived(user.image?.startsWith('/avatar/') ? user.image : null);
	const initials = $derived(
		user.name
			.split(/\s+/)
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase() || '?'
	);

	async function logout() {
		await fetch('/api/auth/sign-out', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
		await invalidateAll();
		await goto('/login');
	}
</script>

<header class="flex h-14 items-center gap-2 border-b bg-background px-4">
	<Button
		variant="ghost"
		size="icon"
		class="lg:hidden"
		aria-label="Navigation öffnen"
		onclick={() => (menuOpen = true)}
	>
		<Menu />
	</Button>
	<Sheet bind:open={menuOpen}>
		<!-- Volle Höhe, Kopf fest, Navigation scrollt (kleine Geräte, Querformat) -->
		<SheetContent side="left" class="flex h-dvh w-72 max-w-[85vw] flex-col gap-0 p-0">
			<SheetHeader class="shrink-0 border-b p-4">
				<SheetTitle>{systemName}</SheetTitle>
			</SheetHeader>
			<div
				class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]"
			>
				<SidebarNav {permissions} {navigation} onnavigate={() => (menuOpen = false)} />
			</div>
		</SheetContent>
	</Sheet>

	<div class="flex-1"></div>

	<Button
		variant="outline"
		class="h-9 gap-2 px-2 text-muted-foreground sm:w-56 sm:justify-start sm:px-3"
		aria-label="Suchen (Strg+K)"
		aria-keyshortcuts="Control+K Meta+K"
		onclick={() => (paletteOpen = true)}
	>
		<SearchIcon />
		<span class="hidden flex-1 text-left sm:inline">Suchen</span>
		<kbd
			class="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-xs sm:inline"
			aria-hidden="true">Strg K</kbd
		>
	</Button>
	<CommandPalette {permissions} {navigation} bind:open={paletteOpen} />

	<DropdownMenu>
		<DropdownMenuTrigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon"
					aria-label="Darstellung wählen (aktuell: {THEME_LABELS[theme.choice]})"
				>
					{#if theme.dark}<Moon />{:else}<Sun />{/if}
				</Button>
			{/snippet}
		</DropdownMenuTrigger>
		<DropdownMenuContent align="end" class="w-40">
			<DropdownMenuLabel>Darstellung</DropdownMenuLabel>
			<DropdownMenuRadioGroup
				value={theme.choice}
				onValueChange={(v) => theme.set(v as ThemeChoice)}
			>
				<DropdownMenuRadioItem value="light" closeOnSelect><Sun /> Hell</DropdownMenuRadioItem>
				<DropdownMenuRadioItem value="dark" closeOnSelect><Moon /> Dunkel</DropdownMenuRadioItem>
				<DropdownMenuRadioItem value="system" closeOnSelect
					><Monitor /> System</DropdownMenuRadioItem
				>
			</DropdownMenuRadioGroup>
		</DropdownMenuContent>
	</DropdownMenu>

	<DropdownMenu>
		<DropdownMenuTrigger>
			{#snippet child({ props })}
				<Button {...props} variant="ghost" class="h-9 gap-2 px-2" aria-label="Benutzermenü">
					<Avatar class="size-7">
						{#if avatarSrc}<AvatarImage src={avatarSrc} alt="" />{/if}
						<AvatarFallback>{initials}</AvatarFallback>
					</Avatar>
					<span class="hidden max-w-40 truncate text-sm sm:inline">{user.name}</span>
				</Button>
			{/snippet}
		</DropdownMenuTrigger>
		<DropdownMenuContent align="end" class="w-56">
			<DropdownMenuLabel>
				<div class="truncate text-sm font-medium">{user.name}</div>
				<div class="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
			</DropdownMenuLabel>
			<DropdownMenuSeparator />
			<DropdownMenuItem onSelect={() => goto('/profile')}><UserIcon /> Profil</DropdownMenuItem>
			<DropdownMenuItem onSelect={logout}><LogOut /> Abmelden</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>
</header>
