# ================================================================
#  WISP System - Dockerfile Web UI (React + Vite + Tailwind)
#  Build estático servido por Nginx Alpine
# ================================================================

FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_API_URL=http://localhost/api
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Imagen final: Nginx solo para servir estáticos ────────────────
FROM nginx:1.25-alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Configuración para React Router (SPA)
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri $uri/ /index.html; }\n  gzip on;\n  gzip_types text/css application/javascript application/json;\n}\n' \
    > /etc/nginx/conf.d/default.conf

EXPOSE 80
