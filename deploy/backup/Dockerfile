# Sicherungsdienst `db-backup` (Issue #40): pg_dump + rclone (Objektspeicher) + restic (verschlüsselt, Aufbewahrung).
# Basis = dieselbe PostgreSQL-Version wie der Dienst `db`, damit pg_dump/pg_restore zur Server-Version passen.
# Bei einem Update von `db` (docker-compose*.yml) diese Zeile mitziehen.
FROM postgres:17.11-alpine3.24

# restic/rclone aus Alpine (Paketversionen folgen dem Alpine-Release 3.24)
RUN apk add --no-cache restic rclone tzdata \
	&& mkdir -p /work /backups \
	&& chown postgres:postgres /work /backups \
	&& chmod 0700 /work /backups

COPY --chmod=0755 backup.sh /usr/local/bin/ep-backup

USER postgres
WORKDIR /work
# Das postgres-Image setzt STOPSIGNAL SIGINT; das Skript beendet sich auf TERM und INT.
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10m --timeout=10s --start-period=1m --retries=1 CMD ["/usr/local/bin/ep-backup", "health"]
ENTRYPOINT ["/usr/local/bin/ep-backup"]
CMD ["schedule"]
