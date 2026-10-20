/**
 * Zerlegt ein SQL-Skript an Semikolons in einzelne Statements. Berücksichtigt Zeichenketten,
 * quotierte Bezeichner, Zeilen-/Blockkommentare und Dollar-Quoting. Nötig, weil manche Treiber
 * (PGlite) pro Aufruf nur ein Statement erlauben.
 */
export function splitSqlStatements(script: string): string[] {
	const out: string[] = [];
	let cur = '';
	let i = 0;
	const n = script.length;

	while (i < n) {
		const c = script[i]!;
		const next = script[i + 1];

		if (c === '-' && next === '-') {
			const end = script.indexOf('\n', i);
			const stop = end === -1 ? n : end;
			i = stop;
			continue;
		}
		if (c === '/' && next === '*') {
			const end = script.indexOf('*/', i + 2);
			i = end === -1 ? n : end + 2;
			continue;
		}
		if (c === "'" || c === '"') {
			let j = i + 1;
			while (j < n) {
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
		if (c === '$') {
			const m = /^\$[A-Za-z_]*\$/.exec(script.slice(i));
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
