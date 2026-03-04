#!/usr/bin/env bash
# ================================================================
#  WISP System - Fix: Agregar package.json y corregir Dockerfiles
#  Uso: sudo bash fix-packages.sh
# ================================================================
set -e

WISP_DIR="/opt/wisp-system"
cd "$WISP_DIR"

echo "[1/4] Copiando package.json a cada servicio..."

# ── API Core ─────────────────────────────────────────────────────
cat > api-core/package.json << 'EOF'
{
  "name": "wisp-api-core",
  "version": "1.0.0",
  "type": "module",
  "main": "src/app.js",
  "scripts": {
    "start": "node src/app.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "morgan": "^1.10.0",
    "mariadb": "^3.3.0",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "node-routeros": "^1.6.3",
    "node-cron": "^3.0.3",
    "dotenv": "^16.4.5",
    "nodemailer": "^6.9.9"
  }
}
EOF
echo "  ✓ api-core/package.json"

# ── Mikrotik Worker ───────────────────────────────────────────────
cat > mikrotik-worker/package.json << 'EOF'
{
  "name": "wisp-mikrotik-worker",
  "version": "1.0.0",
  "type": "module",
  "main": "src/worker.js",
  "scripts": {
    "start": "node src/worker.js"
  },
  "dependencies": {
    "node-cron": "^3.0.3",
    "node-routeros": "^1.6.3",
    "dotenv": "^16.4.5"
  }
}
EOF
echo "  ✓ mikrotik-worker/package.json"

# ── Web UI ────────────────────────────────────────────────────────
cat > web-ui/package.json << 'EOF'
{
  "name": "wisp-web-ui",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0",
    "axios": "^1.6.7"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.1.4",
    "tailwindcss": "^3.4.1",
    "autoprefixer": "^10.4.17",
    "postcss": "^8.4.35"
  }
}
EOF
echo "  ✓ web-ui/package.json"

echo "[2/4] Corrigiendo Dockerfiles (npm ci → npm install)..."

# Corregir api-core/Dockerfile
sed -i 's/npm ci --only=production/npm install --only=production/g' api-core/Dockerfile
sed -i 's/npm ci$/npm install/g' api-core/Dockerfile
# Aumentar tiempo de start en healthcheck
sed -i 's/start-period=30s/start-period=60s/g' api-core/Dockerfile
echo "  ✓ api-core/Dockerfile"

sed -i 's/npm ci --only=production/npm install --only=production/g' mikrotik-worker/Dockerfile
echo "  ✓ mikrotik-worker/Dockerfile"

sed -i 's/npm ci$/npm install/g' web-ui/Dockerfile
echo "  ✓ web-ui/Dockerfile"

echo "[3/4] Removiendo línea 'version' obsoleta del docker-compose.yml..."
sed -i '/^version:/d' docker-compose.yml
echo "  ✓ docker-compose.yml"

echo "[4/4] Reconstruyendo contenedores..."
docker compose down
docker compose build --no-cache
docker compose up -d

echo ""
echo "Esperando que los servicios inicien (30s)..."
sleep 30
docker compose ps

echo ""
echo "✓ Fix aplicado. Verifica: curl http://localhost/api/health"
