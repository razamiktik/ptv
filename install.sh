#!/usr/bin/env bash
# ================================================================
#  WISP System v2 - Instalador Linux
#  Uso: chmod +x install.sh && sudo ./install.sh
# ================================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

echo -e "${CYAN}${BOLD}"
echo "  ╔══════════════════════════════════╗"
echo "  ║     WISP System v2 Installer     ║"
echo "  ╚══════════════════════════════════╝"
echo -e "${NC}"

[[ $EUID -ne 0 ]] && err "Ejecuta como root: sudo ./install.sh"

INSTALL_DIR="${WISP_DIR:-/opt/wisp-system}"

# ── Docker ───────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    warn "Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    log "Docker instalado."
else
    log "Docker: $(docker --version)"
fi

if ! docker compose version &>/dev/null; then
    warn "Instalando Docker Compose plugin..."
    apt-get install -yq docker-compose-plugin 2>/dev/null || true
fi
log "Docker Compose: $(docker compose version --short)"

# ── Copiar archivos ───────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
cp -r ./* "$INSTALL_DIR/"
cd "$INSTALL_DIR"
log "Archivos copiados a $INSTALL_DIR"

# ── Verificar .env ────────────────────────────────────────────────
if [[ ! -f .env ]]; then
    cp .env.example .env 2>/dev/null || true
    warn ".env no encontrado. Usando valores por defecto."
fi

# Asegurarse de que las variables de DB están definidas
grep -q "^DB_ROOT_PASSWORD=." .env || echo "DB_ROOT_PASSWORD=WispRoot$(openssl rand -hex 8)" >> .env
grep -q "^DB_NAME=."          .env || echo "DB_NAME=wispdb"        >> .env
grep -q "^DB_USER=."          .env || echo "DB_USER=wispuser"      >> .env
grep -q "^DB_PASSWORD=."      .env || echo "DB_PASSWORD=WispPass$(openssl rand -hex 8)" >> .env
grep -q "^JWT_SECRET=."       .env || echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
grep -q "^WORKER_SECRET_KEY=." .env || echo "WORKER_SECRET_KEY=$(openssl rand -hex 16)" >> .env
grep -q "^HTTP_PORT=."        .env || echo "HTTP_PORT=80"          >> .env

chmod 600 .env
log ".env verificado."

# ── Build & Up ────────────────────────────────────────────────────
echo ""
warn "Construyendo imágenes Docker (puede tardar 3-5 minutos la primera vez)..."
docker compose build --no-cache
log "Build completado."

docker compose up -d
log "Servicios iniciados."

# ── Esperar ───────────────────────────────────────────────────────
echo -n "Esperando que la API esté lista"
for i in {1..40}; do
    if curl -sf http://localhost/health &>/dev/null; then
        echo -e " ${GREEN}✓${NC}"; break
    fi
    echo -n "."; sleep 3
done

# ── Systemd ───────────────────────────────────────────────────────
cat > /etc/systemd/system/wisp-system.service << EOF
[Unit]
Description=WISP System
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable wisp-system
log "Autoarranque configurado."

# ── Resumen ───────────────────────────────────────────────────────
HOST_IP=$(hostname -I | awk '{print $1}')
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗"
echo        "║   WISP System instalado exitosamente!            ║"
echo        "╠══════════════════════════════════════════════════╣"
echo        "║  Panel:     http://$HOST_IP                      ║"
echo        "║  Usuario:   admin                                 ║"
echo        "║  Contraseña: Admin1234                            ║"
echo        "╚══════════════════════════════════════════════════╝${NC}"
echo ""
docker compose ps
