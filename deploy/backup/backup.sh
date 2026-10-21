#!/bin/sh
# Automatische Sicherung für EP Intern (Dienst `db-backup`, Issue #40).
#
# Ablauf je Lauf: pg_dump (Custom-Format) → Objektspeicher per rclone in ein lokales Spiegelverzeichnis →
# restic-Snapshot (verschlüsselt, dedupliziert) → Aufbewahrung (forget --prune) → sonntags `restic check`.
# Ziel ist ein restic-Repository (RESTIC_REPOSITORY): lokal (Volume, nur gegen Fehlbedienung) oder
# außerhalb des Hosts (s3:…, rest:…, b2:…). Fehler werden geloggt und optional per Webhook gemeldet.
#
# Befehle: schedule (Standard, täglich um BACKUP_TIME) | run (sofort einmal) | snapshots | check |
#          restore <snapshot|latest> [ziel] | restore-db <dump-datei> | health
set -eu

: "${BACKUP_TIME:=02:30}"
: "${BACKUP_KEEP_DAILY:=7}"
: "${BACKUP_KEEP_WEEKLY:=4}"
: "${BACKUP_KEEP_MONTHLY:=6}"
: "${BACKUP_MAX_AGE_HOURS:=26}"
: "${BACKUP_RUN_ON_START:=false}"
: "${BACKUP_WORK_DIR:=/work}"
: "${RESTIC_REPOSITORY:=/backups/restic}"
: "${PGHOST:=db}"
: "${PGPORT:=5432}"
export RESTIC_REPOSITORY PGHOST PGPORT
export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-$BACKUP_WORK_DIR/.cache/restic}"
export RCLONE_CONFIG="${RCLONE_CONFIG:-/tmp/rclone.conf}"

# Zugang zum Offsite-Repository (S3-kompatibel); eigene Namen, damit sie nicht mit S3_* der App kollidieren
if [ -n "${BACKUP_REPO_ACCESS_KEY_ID:-}" ]; then export AWS_ACCESS_KEY_ID="$BACKUP_REPO_ACCESS_KEY_ID"; fi
if [ -n "${BACKUP_REPO_SECRET_ACCESS_KEY:-}" ]; then export AWS_SECRET_ACCESS_KEY="$BACKUP_REPO_SECRET_ACCESS_KEY"; fi
if [ -n "${BACKUP_REPO_REGION:-}" ]; then export AWS_DEFAULT_REGION="$BACKUP_REPO_REGION"; fi

DUMP_DIR="$BACKUP_WORK_DIR/db"
OBJ_DIR="$BACKUP_WORK_DIR/objects"
STATE_DIR="$BACKUP_WORK_DIR/.state"
LOCK_DIR="/tmp/ep-backup.lock"

log() { printf '%s [ep-backup] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
fail() { log "FEHLER: $*"; return 1; }

notify() {
	# $1 = ok|fail, $2 = Text. Fehler beim Melden brechen nichts ab.
	if [ "$1" = ok ] && [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
		wget -q -T 20 -O /dev/null "$BACKUP_HEARTBEAT_URL" || log "Warnung: Heartbeat nicht erreichbar"
	fi
	if [ "$1" = fail ] && [ -n "${BACKUP_NOTIFY_URL:-}" ]; then
		wget -q -T 20 -O /dev/null --post-data="$2" "$BACKUP_NOTIFY_URL" ||
			log "Warnung: Fehlermeldung an BACKUP_NOTIFY_URL nicht zustellbar"
	fi
}

require_config() {
	[ -n "${RESTIC_PASSWORD:-}" ] || fail "RESTIC_PASSWORD fehlt (Schlüssel des Sicherungs-Repositorys, getrennt aufbewahren)" || return 1
	[ "${#RESTIC_PASSWORD}" -ge 20 ] || fail "RESTIC_PASSWORD ist zu kurz (mindestens 20 Zeichen, zufällig)" || return 1
	[ -n "${PGPASSWORD:-}" ] || fail "PGPASSWORD fehlt" || return 1
	[ -n "${PGUSER:-}" ] && [ -n "${PGDATABASE:-}" ] || fail "PGUSER/PGDATABASE fehlen" || return 1
	case "$RESTIC_REPOSITORY" in
	/*) log "Hinweis: Repository liegt auf diesem Host ($RESTIC_REPOSITORY) – schützt nicht vor Plattenausfall. Offsite-Ziel per RESTIC_REPOSITORY setzen." ;;
	esac
}

ensure_repo() {
	if ! restic cat config >/dev/null 2>&1; then
		log "Repository noch nicht vorhanden – lege es an"
		restic init
	fi
	restic unlock >/dev/null 2>&1 || true
}

dump_db() {
	mkdir -p "$DUMP_DIR"
	tmp="$DUMP_DIR/.${PGDATABASE}.dump.partial"
	log "Datenbank sichern ($PGDATABASE@$PGHOST)"
	pg_dump --format=custom --compress=6 --no-owner --file="$tmp" "$PGDATABASE"
	mv -f "$tmp" "$DUMP_DIR/${PGDATABASE}.dump"
}

sync_objects() {
	if [ -z "${BACKUP_S3_ENDPOINT:-}" ] || [ -z "${BACKUP_S3_BUCKET:-}" ] || [ -z "${BACKUP_S3_ACCESS_KEY_ID:-}" ]; then
		log "Warnung: Objektspeicher nicht konfiguriert (BACKUP_S3_*) – nur die Datenbank wird gesichert"
		return 0
	fi
	export RCLONE_CONFIG_SRC_TYPE=s3
	export RCLONE_CONFIG_SRC_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
	export RCLONE_CONFIG_SRC_ENDPOINT="$BACKUP_S3_ENDPOINT"
	export RCLONE_CONFIG_SRC_REGION="${BACKUP_S3_REGION:-us-east-1}"
	export RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
	export RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}"
	export RCLONE_CONFIG_SRC_FORCE_PATH_STYLE="${BACKUP_S3_FORCE_PATH_STYLE:-true}"
	mkdir -p "$OBJ_DIR"
	log "Objektspeicher spiegeln (Bucket $BACKUP_S3_BUCKET)"
	rclone sync "src:$BACKUP_S3_BUCKET" "$OBJ_DIR" --fast-list --checksum --transfers 4 --stats-one-line --stats 0
}

run_backup() {
	if ! mkdir "$LOCK_DIR" 2>/dev/null; then
		log "Es läuft bereits eine Sicherung – übersprungen"
		return 0
	fi
	trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
	started=$(date +%s)
	# Eigene Subshell mit `set -e` außerhalb einer if-Bedingung (dort wäre errexit wirkungslos)
	set +e
	(
		set -e
		require_config
		ensure_repo
		dump_db
		sync_objects
		log "Snapshot anlegen"
		restic backup --host ep-intern --tag ep-intern --one-file-system \
			--exclude "$BACKUP_WORK_DIR/.cache" --exclude "$STATE_DIR" --exclude "$BACKUP_WORK_DIR/restore" 			"$BACKUP_WORK_DIR"
		log "Aufbewahrung: $BACKUP_KEEP_DAILY täglich / $BACKUP_KEEP_WEEKLY wöchentlich / $BACKUP_KEEP_MONTHLY monatlich"
		restic forget --host ep-intern --tag ep-intern --prune \
			--keep-daily "$BACKUP_KEEP_DAILY" --keep-weekly "$BACKUP_KEEP_WEEKLY" --keep-monthly "$BACKUP_KEEP_MONTHLY"
		if [ "$(date +%u)" = 7 ]; then
			log "Wöchentliche Prüfung des Repositorys (5 % der Daten)"
			restic check --read-data-subset=5%
		fi
	)
	rc=$?
	set -e
	if [ "$rc" -eq 0 ]; then
		mkdir -p "$STATE_DIR"
		date +%s >"$STATE_DIR/last-success"
		log "Sicherung erfolgreich ($(($(date +%s) - started)) s)"
		notify ok ""
	else
		log "SICHERUNG FEHLGESCHLAGEN – Details siehe oben"
		notify fail "EP Intern: Sicherung fehlgeschlagen am $(date '+%Y-%m-%d %H:%M') (Logs: docker compose logs db-backup)"
		rc=1
	fi
	rmdir "$LOCK_DIR" 2>/dev/null || true
	trap - EXIT
	return "$rc"
}

health() {
	now=$(date +%s)
	limit=$((BACKUP_MAX_AGE_HOURS * 3600))
	if [ -f "$STATE_DIR/last-success" ]; then
		last=$(cat "$STATE_DIR/last-success")
		[ $((now - last)) -le "$limit" ] && exit 0
		echo "letzte erfolgreiche Sicherung älter als ${BACKUP_MAX_AGE_HOURS} h"
		exit 1
	fi
	# Noch keine Sicherung: gesund, solange der Dienst kürzer als die Grenze läuft
	started=$(cat /tmp/ep-backup.started 2>/dev/null || echo "$now")
	[ $((now - started)) -le "$limit" ] && exit 0
	echo "noch keine erfolgreiche Sicherung"
	exit 1
}

schedule() {
	date +%s >/tmp/ep-backup.started
	case "$BACKUP_TIME" in
	[0-2][0-9]:[0-5][0-9]) ;;
	*) fail "BACKUP_TIME muss HH:MM sein (z. B. 02:30)" || exit 1 ;;
	esac
	require_config || log "Konfiguration unvollständig – Läufe schlagen fehl, bis sie ergänzt ist"
	log "Zeitplan: täglich um $BACKUP_TIME (TZ=${TZ:-UTC}), Repository $RESTIC_REPOSITORY"
	trap 'log "Beende (Signal)"; exit 0' TERM INT
	if [ "$BACKUP_RUN_ON_START" = true ]; then run_backup || true; fi
	last_day=""
	while :; do
		if [ "$(date +%H:%M)" = "$BACKUP_TIME" ] && [ "$(date +%F)" != "$last_day" ]; then
			last_day=$(date +%F)
			run_backup || true
		fi
		sleep 20 &
		wait $! || true
	done
}

cmd="${1:-schedule}"
[ $# -gt 0 ] && shift
case "$cmd" in
schedule) schedule ;;
run) run_backup ;;
snapshots) require_config && restic snapshots --host ep-intern ;;
check) require_config && restic check ;;
restore)
	require_config
	snap="${1:-latest}"
	target="${2:-$BACKUP_WORK_DIR/restore}"
	log "Snapshot $snap nach $target wiederherstellen"
	restic restore "$snap" --host ep-intern --target "$target"
	log "Fertig: Datenbank unter $target$DUMP_DIR, Dateien unter $target$OBJ_DIR"
	;;
restore-db)
	[ -n "${1:-}" ] || fail "Aufruf: restore-db <pfad/zur/datei.dump>" || exit 1
	log "Spiele $1 in $PGDATABASE@$PGHOST ein (vorhandene Objekte werden ersetzt)"
	pg_restore --clean --if-exists --no-owner --single-transaction --dbname="$PGDATABASE" "$1"
	;;
health) health ;;
*)
	echo "Unbekannter Befehl: $cmd (schedule|run|snapshots|check|restore|restore-db|health)" >&2
	exit 2
	;;
esac
