import type { Component } from 'svelte';
import Backpack from '@lucide/svelte/icons/backpack';
import Bell from '@lucide/svelte/icons/bell';
import Box from '@lucide/svelte/icons/box';
import Briefcase from '@lucide/svelte/icons/briefcase';
import Calendar from '@lucide/svelte/icons/calendar';
import Cloud from '@lucide/svelte/icons/cloud';
import ChartBar from '@lucide/svelte/icons/chart-bar';
import FileText from '@lucide/svelte/icons/file-text';
import Folder from '@lucide/svelte/icons/folder';
import Globe from '@lucide/svelte/icons/globe';
import DatabaseBackup from '@lucide/svelte/icons/database-backup';
import HardDrive from '@lucide/svelte/icons/hard-drive';
import House from '@lucide/svelte/icons/house';
import Images from '@lucide/svelte/icons/images';
import KeyRound from '@lucide/svelte/icons/key-round';
import SquareKanban from '@lucide/svelte/icons/square-kanban';
import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import LayoutGrid from '@lucide/svelte/icons/layout-grid';
import Mail from '@lucide/svelte/icons/mail';
import Presentation from '@lucide/svelte/icons/presentation';
import Puzzle from '@lucide/svelte/icons/puzzle';
import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
import ScrollText from '@lucide/svelte/icons/scroll-text';
import Settings from '@lucide/svelte/icons/settings';
import Shield from '@lucide/svelte/icons/shield';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Terminal from '@lucide/svelte/icons/terminal';
import User from '@lucide/svelte/icons/user';
import Users from '@lucide/svelte/icons/users';
import Wrench from '@lucide/svelte/icons/wrench';
import Wallet from '@lucide/svelte/icons/wallet';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Icon = Component<any>;

const ICONS: Record<string, Icon> = {
	backpack: Backpack,
	bell: Bell,
	box: Box,
	briefcase: Briefcase,
	calendar: Calendar,
	cloud: Cloud,
	chart: ChartBar,
	'chart-bar': ChartBar,
	'file-text': FileText,
	file: FileText,
	folder: Folder,
	globe: Globe,
	'database-backup': DatabaseBackup,
	'hard-drive': HardDrive,
	home: House,
	house: House,
	images: Images,
	kanban: SquareKanban,
	'key-round': KeyRound,
	'layout-dashboard': LayoutDashboard,
	'layout-grid': LayoutGrid,
	mail: Mail,
	offices: Briefcase,
	presentation: Presentation,
	puzzle: Puzzle,
	'rotate-ccw': RotateCcw,
	'scroll-text': ScrollText,
	settings: Settings,
	'shopping-basket': ShoppingBasket,
	shield: Shield,
	sparkles: Sparkles,
	terminal: Terminal,
	user: User,
	users: Users,
	wallet: Wallet,
	wrench: Wrench
};

/** Icon-Lookup per Manifest-Name; unbekannte Namen fallen auf `Box` zurück. */
export function iconFor(name: string | undefined): Icon {
	return (name && ICONS[name]) || Box;
}
