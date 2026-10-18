<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Menu from '@lucide/svelte/icons/menu';
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
		DropdownMenuSeparator,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '$lib/components/ui/sheet';
	import { theme } from '$lib/theme.svelte';
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
		<SheetContent side="left" class="w-72 p-0">
			<SheetHeader class="border-b p-4">
				<SheetTitle>{systemName}</SheetTitle>
			</SheetHeader>
			<SidebarNav {permissions} {navigation} onnavigate={() => (menuOpen = false)} />
		</SheetContent>
	</Sheet>

	<div class="flex-1"></div>

	<DropdownMenu>
		<DropdownMenuTrigger>
			{#snippet child({ props })}
				<Button {...props} variant="ghost" size="icon" aria-label="Darstellung wählen">
					{#if theme.dark}<Moon />{:else}<Sun />{/if}
				</Button>
			{/snippet}
		</DropdownMenuTrigger>
		<DropdownMenuContent align="end">
			<DropdownMenuItem onSelect={() => theme.set('light')}><Sun /> Hell</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => theme.set('dark')}><Moon /> Dunkel</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => theme.set('system')}><Monitor /> System</DropdownMenuItem>
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
