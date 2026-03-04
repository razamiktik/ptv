# ================================================================
#  WISP System - Dockerfile API Core (CORREGIDO)
# ================================================================

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
# Usar "npm install" en lugar de "npm ci" (no requiere package-lock.json)
RUN npm install --only=production && npm cache clean --force

FROM node:20-alpine AS production
RUN apk add --no-cache wget tini
WORKDIR /app

RUN addgroup -g 1001 wisp && adduser -u 1001 -G wisp -s /bin/sh -D wisp

COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY package.json ./

RUN mkdir -p plugins logs && chown -R wisp:wisp /app

USER wisp
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/app.js"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -qO- http://localhost:3000/health || exit 1
