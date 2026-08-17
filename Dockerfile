# ─── Stage 1: build the React SPA ────────────────────────────────────────────
FROM node:22-alpine AS frontend

WORKDIR /build
COPY icms-frontend/package*.json ./
RUN npm ci

COPY icms-frontend/ ./
# The SPA is served from the same origin as the API in production, so the API
# base is a relative path and needs no build-time host.
ENV VITE_API_URL=""
RUN npm run build

# ─── Stage 2: install production API dependencies ────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /build
COPY icms-backend/package*.json ./
RUN npm ci --omit=dev

# ─── Stage 3: runtime ────────────────────────────────────────────────────────
FROM node:22-alpine

# mariadb-client provides the `mariadb` CLI the entrypoint uses to wait for the
# database and apply the schema. curl is used by the container healthcheck.
RUN apk add --no-cache mariadb-client curl tini \
 && addgroup -g 10001 icms \
 && adduser -D -u 10001 -G icms icms

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps     /build/node_modules ./node_modules
COPY icms-backend/src              ./src
COPY icms-backend/schema.mariadb.sql ./
COPY icms-backend/migrate-to-mariadb.js ./
COPY icms-backend/package.json     ./
COPY --from=frontend /build/dist   ./public
COPY docker/entrypoint.sh          /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/uploads \
 && chown -R icms:icms /app

USER icms
EXPOSE 3001

# tini reaps zombies and forwards SIGTERM so the container stops promptly.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "src/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/api/health || exit 1
