/**
 * Datenbankfehler sicher erkennen und beschreiben (#55, #56).
 *
 * drizzle-orm (ab 0.45) verpackt jeden Treiberfehler in `DrizzleQueryError`: die Message lautet
 * `Failed query: <SQL>\nparams: <Werte>` – sie enthält also **alle Parameterwerte** (Namen,
 * Geburtsdaten, Gesundheitsangaben, Chiffrate). Der eigentliche Postgres-Fehler (SQLSTATE, Constraint,
 * Tabelle) steckt nur in `cause`. Deshalb:
 * - `isUniqueViolation(e, constraint?)` läuft die `cause`-Kette ab (SQLSTATE `23505`).
 * - `describeError(e)` liefert eine Beschreibung **ohne Parameterwerte** fürs Log;
 *   `errorSummary(e)` eine einzeilige Kurzfassung (z. B. für `job_run.last_message`).
 * Treiberfehler werden nur über bekannte Felder gelesen (nie generisch serialisiert), weil auch
 * PGlite/pg Abfrage und Parameter an Fehler hängen können.
 */

/** Maximale Tiefe der `cause`-Kette */
const MAX_DEPTH = 8;
const SQL_PREVIEW_MAX = 200;
const MESSAGE_MAX = 300;

export interface ErrorDescription {
	/** Klasse der äußersten Hülle, z. B. `DrizzleQueryError`, `TypeError` */
	name: string;
	/** SQLSTATE (z. B. `23505`) oder ein anderer Fehlercode aus der Kette */
	code?: string;
	/** Meldung ohne SQL-Parameter und ohne Postgres-`detail` */
	message: string;
	constraint?: string;
	table?: string;
	/** Anfang der SQL-Anweisung (nur Text mit Platzhaltern `$1`, nie Werte) */
	sqlPreview?: string;
	/** Stack ohne Kopfzeilen der Message (nur serverseitig loggen, nie ausliefern) */
	stack?: string;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const str = (v: unknown): string | undefined =>
	typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined;

/** Alle Glieder der Kette `e → e.cause → …` (zyklensicher, begrenzt). */
function chain(e: unknown): Obj[] {
	const out: Obj[] = [];
	let cur: unknown = e;
	while (isObj(cur) && out.length < MAX_DEPTH && !out.includes(cur)) {
		out.push(cur);
		cur = cur.cause;
	}
	return out;
}

/** Eine Drizzle-Hülle (Message enthält SQL + Parameter). Erkannt am Namen oder an `query`/`params`. */
function isQueryWrapper(o: Obj): boolean {
	const name = o.constructor && (o.constructor as { name?: unknown }).name;
	if (name === 'DrizzleQueryError') return true;
	return (
		typeof o.query === 'string' &&
		'params' in o &&
		typeof o.message === 'string' &&
		o.message.startsWith('Failed query:')
	);
}

/** Postgres-Fehler: hat einen 5-stelligen SQLSTATE. */
const SQLSTATE_RE = /^[0-9A-Z]{5}$/;
const isPgError = (o: Obj): boolean => typeof o.code === 'string' && SQLSTATE_RE.test(o.code);

/**
 * `true`, wenn irgendwo in der `cause`-Kette eine Unique-Verletzung (SQLSTATE `23505`) steckt.
 * Mit `constraint`: nur, wenn deren Constraint-/Indexname gleich ist bzw. ihn enthält
 * (Postgres meldet Unique-Indizes als Constraint).
 */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
	for (const o of chain(e)) {
		if (str(o.code) !== '23505') continue;
		if (!constraint) return true;
		const name = str(o.constraint) ?? '';
		if (name === constraint || name.includes(constraint)) return true;
		// Fallback: manche Treiber liefern den Namen nur in der Meldung
		if (!name && typeof o.message === 'string' && o.message.includes(constraint)) {
			return true;
		}
	}
	return false;
}

/**
 * Postgres-Meldung ohne Werte: Bei Datenfehlern (Klasse 22, z. B. `invalid input syntax for type
 * uuid: "…"`) steht der Eingabewert in Anführungszeichen in der Meldung – er wird ersetzt.
 * `detail` (enthält bei Constraint-Verletzungen die Zeilenwerte) wird nie übernommen.
 */
function safePgMessage(o: Obj): string {
	let msg = String(o.message ?? '');
	if (String(o.code).startsWith('22')) msg = msg.replace(/"(?:[^"\\]|\\.)*"/g, '"…"');
	return cut(msg, MESSAGE_MAX);
}

function cut(s: string, max: number): string {
	const flat = s.replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function errorName(o: Obj): string {
	const ctor = o.constructor as { name?: unknown } | undefined;
	// Unterklassen ohne eigenes `name` (z. B. DrizzleQueryError) heißen sonst nur „Error“
	const own = str(o.name);
	const cls = str(ctor?.name);
	const n = own && own !== 'Error' ? own : (cls ?? own);
	return n && n !== 'Object' ? n : 'Error';
}

/** Stack ohne die Kopfzeilen (die bei der Drizzle-Hülle SQL und Parameter enthalten). */
function safeStack(o: Obj, name: string, message: string): string | undefined {
	if (typeof o.stack !== 'string') return undefined;
	const idx = o.stack.search(/^\s+at /m);
	if (idx < 0) return undefined;
	return `${name}: ${message}\n${o.stack.slice(idx)}`;
}

/** Strukturierte, parameterfreie Beschreibung eines Fehlers für Server-Logs. */
export function describeError(e: unknown): ErrorDescription {
	const links = chain(e);
	const outer = links[0];
	if (!outer) return { name: typeof e, message: cut(String(e), MESSAGE_MAX) };

	const name = errorName(outer);
	const wrapper = links.find(isQueryWrapper);
	const pg = links.find(isPgError);
	let message: string;
	if (pg) {
		message = safePgMessage(pg);
	} else if (wrapper) {
		// Hülle ohne erkennbaren Postgres-Fehler: Meldung des innersten Glieds, nie die der Hülle
		const inner = links[links.length - 1];
		message =
			inner && inner !== wrapper && !isQueryWrapper(inner)
				? cut(String(inner.message ?? ''), MESSAGE_MAX)
				: 'Datenbankabfrage fehlgeschlagen';
	} else {
		message = cut(String(outer.message ?? e), MESSAGE_MAX);
	}

	const out: ErrorDescription = { name, message };
	const code = pg ? str(pg.code) : links.map((o) => str(o.code)).find(Boolean);
	if (code) out.code = code;
	if (pg) {
		const constraint = str(pg.constraint);
		const table = str(pg.table);
		if (constraint) out.constraint = constraint;
		if (table) out.table = table;
	}
	if (wrapper && typeof wrapper.query === 'string') {
		out.sqlPreview = cut(wrapper.query, SQL_PREVIEW_MAX);
	}
	const stack = safeStack(outer, name, wrapper === outer ? 'Failed query' : message);
	if (stack) out.stack = stack;
	return out;
}

/**
 * Einzeilige, parameterfreie Kurzfassung `Name: Code Meldung (constraint …)`, z. B. für
 * `job_run.last_message`. Enthält weder SQL noch Stack.
 */
export function errorSummary(e: unknown): string {
	const d = describeError(e);
	const extra = d.constraint
		? ` (constraint ${d.constraint})`
		: d.table
			? ` (table ${d.table})`
			: '';
	return `${d.name}: ${d.code ? `${d.code} ` : ''}${d.message}${extra}`;
}

/** Loggt `describeError(e)` (ohne Parameterwerte) plus Stack serverseitig per `console.error`. */
export function logError(prefix: string, e: unknown, extra: Record<string, unknown> = {}): void {
	const { stack, ...rest } = describeError(e);
	console.error(prefix, { ...extra, ...rest }, ...(stack ? [`\n${stack}`] : []));
}
