/**
 * Zerlegt ein SQL-Skript an Semikolons in einzelne Statements. Berücksichtigt Zeichenketten
 * (inkl. `E'…'` mit Backslash-Escapes), quotierte Bezeichner, Zeilenkommentare, verschachtelte
 * Blockkommentare und Dollar-Quoting (`$$`, `$tag$`, `$tag_1$`). Nötig, weil manche Treiber
 * (PGlite) pro Aufruf nur ein Statement erlauben. Kommentare werden nicht übernommen.
 */
export function splitSqlStatements(script: string): string[] {
	const out: string[] = [];
	let cur = '';
	let i = 0;
	const n = script.length;
	const isIdentChar = (ch: string | undefined) => !!ch && /[A-Za-z0-9_$]/.test(ch);

	while (i < n) {
		const c = script[i]!;
		const next = script[i + 1];

		if (c === '-' && next === '-') {
			const end = script.indexOf('\n', i);
			i = end === -1 ? n : end;
			continue;
		}
		if (c === '/' && next === '*') {
			// PostgreSQL erlaubt verschachtelte Blockkommentare
			let depth = 1;
			let j = i + 2;
			while (j < n && depth > 0) {
				if (script[j] === '/' && script[j + 1] === '*') {
					depth++;
					j += 2;
				} else if (script[j] === '*' && script[j + 1] === '/') {
					depth--;
					j += 2;
				} else j++;
			}
			i = j;
			// Kommentar trennt Tokens: Leerzeichen statt nichts, damit `a/* */b` nicht zu `ab` wird
			cur += ' ';
			continue;
		}
		if (c === "'" || c === '"') {
			// E'…' (Escape-String): Backslash maskiert das folgende Zeichen
			const prev = script[i - 1];
			const escapeString =
				c === "'" && (prev === 'E' || prev === 'e') && !isIdentChar(script[i - 2]);
			let j = i + 1;
			while (j < n) {
				if (escapeString && script[j] === '\\') {
					j += 2;
					continue;
				}
				if (script[j] === c) {
					if (script[j + 1] === c) {
						j += 2;
						continue;
					}
					break;
				}
				j++;
			}
			cur += script.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		if (c === '$' && !isIdentChar(script[i - 1])) {
			const m = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(script.slice(i));
			if (m) {
				const tag = m[0];
				const end = script.indexOf(tag, i + tag.length);
				const stop = end === -1 ? n : end + tag.length;
				cur += script.slice(i, stop);
				i = stop;
				continue;
			}
		}
		if (c === ';') {
			if (cur.trim()) out.push(cur.trim());
			cur = '';
			i++;
			continue;
		}
		cur += c;
		i++;
	}
	if (cur.trim()) out.push(cur.trim());
	return out;
}
