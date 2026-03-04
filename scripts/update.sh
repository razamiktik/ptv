#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "[1/4] Backup de base de datos..."
mkdir -p backups
source .env
docker compose exec -T db mysqldump -u"$DB_USER" -p"$DB_PASSWORD" --single-transaction "$DB_NAME" \
  | gzip > "backups/backup_$(date +%Y%m%d_%H%M%S).sql.gz"
echo "  Backup creado."

echo "[2/4] Obteniendo actualización..."
git pull origin main 2>/dev/null || echo "  (No es repositorio git, omitiendo pull)"

echo "[3/4] Reconstruyendo..."
docker compose build

echo "[4/4] Reiniciando servicios..."
docker compose up -d --no-deps api-core
sleep 10
docker compose up -d --no-deps web-ui mikrotik-worker nginx

docker compose ps
echo "✓ Actualización completada."
