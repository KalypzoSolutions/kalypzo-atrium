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

# ---- prod-deps: nur Laufzeitabhaengigkeiten ----
FROM base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    BODY_SIZE_LIMIT=110M
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
# Chromium fuer den PDF-Service (inkl. Systembibliotheken)
RUN node node_modules/playwright/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app     && mkdir -p /var/tmp/ep-backup && chown app:app /var/tmp/ep-backup && chmod 0700 /var/tmp/ep-backup
# Temp-Dateien der Datensicherung (Export/Upload bis BACKUP_MAX_BYTES) auf Platte statt im RAM-tmpfs /tmp
# (Issue #38). Compose legt hier das Volume `backup-tmp` ein; ein neues Volume übernimmt Besitzer/Rechte.
VOLUME ["/var/tmp/ep-backup"]
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# adapter-node beendet den HTTP-Server bei SIGTERM geordnet; Compose gibt dafür stop_grace_period 30s
STOPSIGNAL SIGTERM
CMD ["node", "build"]
