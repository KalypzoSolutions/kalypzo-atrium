import { toast } from 'svelte-sonner';

/** Fehlermeldung zu einer fehlgeschlagenen Datei-Antwort (Texte wie in der Mitglieder-Ansicht). */
async function fileErrorMessage(res: Response): Promise<string> {
	if (res.status === 503) {
		return 'Die Dokumentenablage ist gerade nicht verfügbar (Speicher nicht eingerichtet oder nicht erreichbar).';
	}
	if (res.status === 404) return 'Das Dokument wurde nicht gefunden.';
	const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
	return body?.error?.message ?? 'Die Datei konnte nicht geöffnet werden.';
}

function fileNameFrom(res: Response, fallback: string): string {
	const cd = res.headers.get('content-disposition') ?? '';
	const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
	if (star) {
		try {
			return decodeURIComponent(star);
		} catch {
			/* ignorieren */
		}
	}
	return /filename="([^"]+)"/.exec(cd)?.[1] ?? fallback;
}

/**
 * Laedt eine geschuetzte Datei per fetch (Session-Cookie) und oeffnet sie in einem neuen Tab bzw.
 * laedt sie herunter. Fehler (z. B. 503 ohne S3, 404) erscheinen als Toast statt als JSON-Seite.
 * Muss direkt aus einem Klick aufgerufen werden, damit das neue Fenster nicht blockiert wird.
 * Gibt `true` bei Erfolg zurueck.
 */
export async function openProtectedFile(
	href: string,
	options: { fallbackName?: string; download?: boolean } = {}
): Promise<boolean> {
	const fallbackName = options.fallbackName ?? 'datei';
	// Fenster synchron im Klick oeffnen (Popup-Blocker); wird spaeter auf die Blob-URL gesetzt.
	const win = options.download ? null : window.open('', '_blank');
	try {
		const res = await fetch(href, { credentials: 'same-origin' });
		if (!res.ok) throw new Error(await fileErrorMessage(res));
		const name = fileNameFrom(res, fallbackName);
		const url = URL.createObjectURL(await res.blob());
		if (win && !win.closed) {
			win.opener = null;
			win.location.href = url;
		} else {
			const a = document.createElement('a');
			a.href = url;
			a.download = name;
			document.body.appendChild(a);
			a.click();
			a.remove();
		}
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
		return true;
	} catch (e) {
		win?.close();
		toast.error(
			e instanceof TypeError
				? 'Die Datei konnte nicht geladen werden (keine Verbindung zum Server).'
				: e instanceof Error
					? e.message
					: 'Die Datei konnte nicht geöffnet werden.'
		);
		return false;
	}
}
