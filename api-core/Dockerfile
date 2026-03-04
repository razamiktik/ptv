# ================================================================
#  WISP System - Dockerfile API Core
#  Multi-stage build: imagen final ~120MB (vs ~900MB sin optimizar)
# ================================================================

# ── Stage 1: Dependencias ─────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
# Instalar SOLO dependencias de producción en stage final
RUN npm ci --only=production && npm cache clean --force

# ── Stage 2: Build (si usas TypeScript o build step) ─────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
# Si usas TypeScript: RUN npm run build

# ── Stage 3: Imagen de producción ────────────────────────────────
FROM node:20-alpine AS production

# Instalar wget para healthcheck y librerías nativas
RUN apk add --no-cache wget tini

WORKDIR /app

# Usuario no-root por seguridad
RUN addgroup -g 1001 wisp && adduser -u 1001 -G wisp -s /bin/sh -D wisp

# Copiar dependencias y código
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/src          ./src
COPY package*.json ./

# Carpeta de plugins vacía (se montará como volume)
RUN mkdir -p plugins logs && chown -R wisp:wisp /app

USER wisp

EXPOSE 3000

# tini como PID 1 para manejo correcto de señales
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--experimental-vm-modules", "src/app.js"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
