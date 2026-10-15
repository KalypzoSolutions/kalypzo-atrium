# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=24

# ---- deps: alle Abhaengigkeiten (Build) ----
FROM node:${NODE_VERSION}-bookworm-slim AS deps
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
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts

# ---- runtime ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    BODY_SIZE_LIMIT=55M
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
# Chromium fuer den PDF-Service (inkl. Systembibliotheken)
RUN node node_modules/playwright/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build"]
