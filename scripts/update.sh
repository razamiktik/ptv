#!/usr/bin/env bash
# ================================================================
#  WISP System - Script de Actualización (Linux)
#  Uso: ./scripts/update.sh
#  - Hace git pull (o descarga nueva imagen)
#  - Ejecuta migraciones de BD sin pérdida de datos
#  - Reinicia solo los contenedores que cambiaron
# ================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
section() { echo -e "\n${BOLD}${BLUE}══ $* ══${NC}"; }

section "WISP System - Actualización"
echo "Fecha: $(date '+%Y-%m-%d %H:%M:%S')"

# ── Crear backup de BD antes de actualizar ────────────────────────
section "Backup de Base de Datos (pre-actualización)"

BACKUP_DIR="./backups"
BACKUP_FILE="$BACKUP_DIR/wisp_backup_$(date +%Y%m%d_%H%M%S).sql.gz"
mkdir -p "$BACKUP_DIR"

warn "Creando backup: $BACKUP_FILE"
# Leer credenciales del .env
source .env
docker compose exec -T db mysqldump \
  -u"$DB_USER" -p"$DB_PASSWORD" \
  --single-transaction \
  --routines \
  --triggers \
  "$DB_NAME" | gzip > "$BACKUP_FILE"

log "Backup creado: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"

# Mantener solo los últimos 10 backups
ls -t "$BACKUP_DIR"/wisp_backup_*.sql.gz 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true

# ── Obtener nueva versión ─────────────────────────────────────────
section "Obteniendo Nueva Versión"

if [[ -d .git ]]; then
    # Modo desarrollo: git pull
    CURRENT_COMMIT=$(git rev-parse HEAD)
    git stash 2>/dev/null || true
    git pull origin main
    NEW_COMMIT=$(git rev-parse HEAD)
    
    if [[ "$CURRENT_COMMIT" == "$NEW_COMMIT" ]]; then
        warn "No hay cambios en el repositorio. El sistema ya está actualizado."
        exit 0
    fi
    log "Actualizado de $CURRENT_COMMIT a $NEW_COMMIT"
else
    # Modo producción: descargar nuevas imágenes Docker
    log "Descargando imágenes Docker actualizadas..."
    docker compose pull --ignore-buildable
fi

# ── Construir imágenes si hay cambios en Dockerfiles ─────────────
section "Reconstruyendo Contenedores"
docker compose build

# ── Ejecutar migraciones de BD (sin pérdida de datos) ────────────
section "Ejecutando Migraciones de Base de Datos"

# Las migraciones están en /api-core/migrations/
# Solo ejecuta archivos NEW (que no están en la tabla migrations)
docker compose run --rm api-core node src/migrations/runner.js

log "Migraciones completadas."

# ── Reiniciar servicios con zero-downtime (rolling update) ────────
section "Reiniciando Servicios"

# Orden de reinicio: worker primero (sin tráfico), luego API, luego UI
warn "Deteniendo mikrotik-worker..."
docker compose stop mikrotik-worker

warn "Actualizando API Core (rolling restart)..."
docker compose up -d --no-deps api-core
sleep 5  # Esperar que la API esté healthy

# Verificar que la API respondió
for i in {1..12}; do
    if docker compose exec api-core wget -qO- http://localhost:3000/health &>/dev/null; then
        log "API Core responde correctamente."
        break
    fi
    [[ $i -eq 12 ]] && { warn "API no responde. Revisa los logs: docker compose logs api-core"; exit 1; }
    sleep 5
done

warn "Actualizando Web UI..."
docker compose up -d --no-deps web-ui

warn "Reiniciando mikrotik-worker..."
docker compose up -d --no-deps mikrotik-worker

warn "Actualizando Nginx..."
docker compose up -d --no-deps nginx

# ── Estado final ──────────────────────────────────────────────────
section "Estado Post-Actualización"
docker compose ps

echo -e "\n${GREEN}${BOLD}✓ Actualización completada exitosamente.${NC}"
echo "Backup disponible en: $BACKUP_FILE"
echo "Para ver logs: docker compose logs -f"
