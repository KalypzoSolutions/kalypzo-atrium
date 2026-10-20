/**
 * Datensicherung – Geheimnisse beim Export entschlüsseln (→ `SecretMarker`) und beim Import mit dem
 * Schlüssel des Zielservers neu verschlüsseln. Das Quell-`APP_SECRET` wandert nie mit.
 *
 * - `public.setting.value` (jsonb): String auf oberster Ebene mit `enc:v1:` → Zweck `settings`
 * - `public.two_factor.secret`/`.backup_codes`: Better-Auth `symmetricEncrypt` → Zweck `better-auth`
 * - Textspalten in `mod_<x>` mit `enc:v1:` → Zweck `module:<x>` (`core.crypto.forModule`)
 */
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { getAuth } from '../auth';
import { decryptSecret, encryptSecret, isEncrypted, keyedHash } from '../crypto';
import { allDefinitions } from '../modules/registry';
import { moduleSchemaName } from '../modules/types';
import {
	BackupFormatError,
	isSecretMarker,
	KEY_CHECK_INPUT,
	type SecretMarker,
	type SecretPurpose,
	type TableInfo
} from './types';

const TEXT_TYPE = /^(text|character varying(\(\d+\))?|character(\(\d+\))?)$/;
const isTextType = (type: string) => TEXT_TYPE.test(type);
const isJsonbType = (type: string) => type === 'jsonb' || type === 'json';

function moduleIdForSchema(schema: string): string | null {
	for (const d of allDefinitions()) {
		if (moduleSchemaName(d.manifest.id) === schema) return d.manifest.id;
	}
	return null;
}

/** Zweck eines möglichen Geheimnisses in dieser Spalte (Spaltentyp prüfen die Aufrufer). */
export function secretPurposeFor(
	schema: string,
	table: string,
	column: string
): SecretPurpose | null {
	if (schema === 'public') {
		if (table === 'setting' && column === 'value') return 'settings';
		if (table === 'two_factor' && (column === 'secret' || column === 'backup_codes')) {
			return 'better-auth';
		}
		return null;
	}
	if (schema.startsWith('mod_')) {
		const id = moduleIdForSchema(schema);
		return id ? `module:${id}` : null;
	}
	return null;
}

/** Spalte darf (beim Export) Marker erzeugen bzw. (beim Import) Marker enthalten */
function markerColumn(t: TableInfo, column: string, type: string): SecretPurpose | null {
	const p = secretPurposeFor(t.schema, t.table, column);
	if (!p) return null;
	if (p === 'settings') return isJsonbType(type) ? p : null;
	return isTextType(type) ? p : null;
}

async function authKey() {
	return (await getAuth().$context).secretConfig;
}

const marker = (p: SecretPurpose, v: string): SecretMarker => ({ $secret: { p, v } });

/**
 * Verschlüsselte Werte einer Zeile entschlüsseln und als Marker ablegen. Nicht entschlüsselbare
 * Werte bleiben roh und werden gezählt.
 */
export async function encodeRowSecrets(
	t: TableInfo,
	row: Record<string, unknown>
): Promise<{ row: Record<string, unknown>; undecryptable: number }> {
	let out: Record<string, unknown> | null = null;
	let undecryptable = 0;
	for (const col of t.columns) {
		const p = markerColumn(t, col.name, col.type);
		if (!p) continue;
		const v = row[col.name];
		if (typeof v !== 'string' || !v) continue;
		let plain: string | null = null;
		if (p === 'better-auth') {
			try {
				plain = await symmetricDecrypt({ key: await authKey(), data: v });
			} catch {
				undecryptable++;
			}
		} else if (isEncrypted(v)) {
			try {
				plain = decryptSecret(v, p);
			} catch {
				undecryptable++;
			}
		}
		if (plain === null) continue;
		out ??= { ...row };
		out[col.name] = marker(p, plain);
	}
	return { row: out ?? row, undecryptable };
}

/**
 * Marker einer Zeile mit dem Zielschlüssel neu verschlüsseln. Marker nur in text-/jsonb-Spalten;
 * der Zweck muss zu `secretPurposeFor` passen, sonst `BackupFormatError('corrupt')`.
 * In jsonb-Spalten ohne Geheimnis-Zweck bleiben marker-ähnliche Werte unverändert (gewöhnliche Daten).
 */
export async function decodeRowSecrets(
	t: TableInfo,
	row: Record<string, unknown>
): Promise<Record<string, unknown>> {
	let out: Record<string, unknown> | null = null;
	for (const col of t.columns) {
		const v = row[col.name];
		if (!isSecretMarker(v)) continue;
		const expected = markerColumn(t, col.name, col.type);
		if (!expected) {
			if (isJsonbType(col.type)) continue;
			throw new BackupFormatError(
				'corrupt',
				`Unerwarteter verschlüsselter Wert in ${t.schema}.${t.table}.${col.name}`
			);
		}
		if (v.$secret.p !== expected) {
			throw new BackupFormatError(
				'corrupt',
				`Verschlüsselter Wert in ${t.schema}.${t.table}.${col.name} hat einen falschen Zweck`
			);
		}
		const plain = v.$secret.v;
		const enc =
			expected === 'better-auth'
				? await symmetricEncrypt({ key: await authKey(), data: plain })
				: encryptSecret(plain, expected);
		out ??= { ...row };
		out[col.name] = enc;
	}
	return out ?? row;
}

/** Prüfwert des Server-Schlüssels (erkennt beim Import einen anderen `APP_SECRET`). */
export function keyCheckValue(): string {
	return keyedHash(KEY_CHECK_INPUT, 'backup');
}
