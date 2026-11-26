/**
 * Mehrsprachigkeit für Module (Client und Server): `t('<modul-id>.<schlüssel>', params)` liest die Texte aus
 * `modules/<id>/messages/<sprache>.json` (Rückfall Deutsch, sonst der Schlüssel). Format: `{name}`,
 * `{count, plural, one {…} other {…}}`, `{art, select, a {…} other {…}}`. Details `docs/module-development.md`.
 */
export {
	DEFAULT_LOCALE,
	getLocale,
	intlLocale,
	LOCALE_LABELS,
	LOCALES,
	type Locale,
	type LocalizedText,
	localized,
	type MessageParams,
	t,
	tl
} from '$lib/i18n';
export {
	formatBytes,
	formatDate,
	formatDateTime,
	formatMoney,
	formatNumber,
	formatRelative,
	formatTime
} from '$lib/i18n/intl';
