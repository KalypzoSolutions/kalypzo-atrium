# syntax=docker/dockerfile:1.7
# Basis-Image mit fester Version UND Digest (Issue #74): gleiche Basis wie website/Dockerfile, Node-Major = .nvmrc.
# Updates kommen per Dependabot (Tag + Digest gemeinsam anheben).
FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS base

# ---- deps: alle Abhaengigkeiten (Build) ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts

# ---- build ----
FROM deps AS build
WORKDIR /app
COPY . .
ENV APP_SECRET=build-time-placeholder-build-time-placeholder
RUN npm run build

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    BODY_SIZE_LIMIT=110M
# Kalypzo Atrium (Phase 6): Module lassen sich im Panel installieren; der Supervisor baut die App dann im Container
# neu. Dafür braucht das Laufzeit-Image die Quellen und ALLE Abhängigkeiten (Vite, SvelteKit …). Der Ordner bleibt
# schreibgeschützt: Generationen, Build-Ausgabe, Vite-Cache und npm-Cache liegen im Volume /data/atrium.
ENV ATRIUM_DATA_DIR=/data/atrium \
    ATRIUM_MODULE_INSTALL=supervisor \
    ATRIUM_VITE_CACHE=/data/atrium/cache/vite \
    npm_config_cache=/data/atrium/cache/npm \
    TMPDIR=/data/atrium/tmp
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# Chromium fuer den PDF-Service (inkl. Systembibliotheken)
# TMPDIR zeigt erst zur Laufzeit ins Volume (/data/atrium/tmp legt der Supervisor an) – beim Bauen /tmp
RUN TMPDIR=/tmp node node_modules/playwright/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright
# Mitgelieferter Build (läuft, solange keine eigene Generation gebaut ist) und alles für den Neubau
COPY --from=build /app/build ./build
COPY --from=build /app/.svelte-kit ./.svelte-kit
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src
COPY --from=build /app/static ./static
COPY --from=build /app/tools ./tools
COPY --from=build /app/modules ./modules
COPY --from=build /app/scripts/supervisor.mjs ./scripts/supervisor.mjs
COPY --from=build /app/scripts/supervisor ./scripts/supervisor
COPY --from=build /app/svelte.config.js /app/vite.config.ts /app/tsconfig.json /app/package.json /app/package-lock.json ./
# Vite legt die gebündelte Config in node_modules/.vite-temp ab (auch in SvelteKits zweitem Build):
# Link ins Volume, weil /app schreibgeschützt ist (das Ziel legt der Supervisor beim Start an)
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app \
    && mkdir -p /var/tmp/ep-backup && chown app:app /var/tmp/ep-backup && chmod 0700 /var/tmp/ep-backup \
    && mkdir -p /data/atrium && chown app:app /data/atrium && chmod 0700 /data/atrium \
    && ln -s /data/atrium/tmp/vite-temp /app/node_modules/.vite-temp
# Temp-Dateien der Datensicherung (Export/Upload bis BACKUP_MAX_BYTES) auf Platte statt im RAM-tmpfs /tmp
# (Issue #38). Compose legt hier das Volume `backup-tmp` ein; ein neues Volume übernimmt Besitzer/Rechte.
VOLUME ["/var/tmp/ep-backup"]
# Generationen der App (Module, Builds), Lock-Dateien, Protokolle der Neubauten
VOLUME ["/data/atrium"]
USER app
EXPOSE 3000
# start-period großzügig: nach einem Core-Update baut der Supervisor die Module neu (mehrere Minuten)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15m --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Supervisor beendet die App geordnet (IPC → adapter-node schließt den Server); Compose gibt stop_grace_period 45s
STOPSIGNAL SIGTERM
CMD ["node", "scripts/supervisor.mjs"]
