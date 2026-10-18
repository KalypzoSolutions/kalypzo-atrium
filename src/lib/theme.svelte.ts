export type ThemeChoice = 'light' | 'dark' | 'system';

function readCookie(): ThemeChoice {
	if (typeof document === 'undefined') return 'system';
	const m = /(?:^|; )theme=(light|dark|system)/.exec(document.cookie);
	return (m?.[1] as ThemeChoice | undefined) ?? 'system';
}

class ThemeState {
	choice = $state<ThemeChoice>('system');
	dark = $state(false);

	init(): void {
		this.choice = readCookie();
		this.apply();
		window
			.matchMedia('(prefers-color-scheme: dark)')
			.addEventListener('change', () => this.apply());
	}

	set(choice: ThemeChoice): void {
		this.choice = choice;
		document.cookie = `theme=${choice}; path=/; max-age=31536000; SameSite=Lax`;
		this.apply();
		// Optimistisch auch in der Datenbank speichern (`core.user.theme`); ohne Anmeldung/Netz: Cookie genuegt
		void fetch('/profile/theme', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ theme: choice }),
			credentials: 'same-origin'
		}).catch(() => undefined);
	}

	/** Klassen am `<html>` neu setzen (auch von außen nutzbar, wenn Cookie/Datenbank schon gespeichert sind) */
	apply(): void {
		const dark =
			this.choice === 'dark' ||
			(this.choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
		this.dark = dark;
		document.documentElement.classList.toggle('dark', dark);
	}
}

export const theme = new ThemeState();
