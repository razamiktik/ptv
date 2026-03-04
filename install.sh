#!/usr/bin/env bash
# ================================================================
#  WISP System - Instalador para Linux (Ubuntu/Debian/CentOS)
#  Uso: chmod +x install.sh && sudo ./install.sh
# ================================================================

set -euo pipefail

# ── Colores ──────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
section() { echo -e "\n${BOLD}${BLUE}══ $* ══${NC}"; }

# ── Banner ───────────────────────────────────────────────────────
echo -e "${CYAN}"
cat << 'EOF'
 ██╗    ██╗██╗███████╗██████╗
 ██║    ██║██║██╔════╝██╔══██╗
 ██║ █╗ ██║██║███████╗██████╔╝
 ██║███╗██║██║╚════██║██╔═══╝
 ╚███╔███╔╝██║███████║██║
  ╚══╝╚══╝ ╚═╝╚══════╝╚═╝  Sistema WISP v1.0
EOF
echo -e "${NC}"

# ── Verificar root ───────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Ejecuta como root: sudo ./install.sh"

INSTALL_DIR="${WISP_DIR:-/opt/wisp-system}"
section "Detectando Sistema Operativo"

# Detectar distro
if   [[ -f /etc/os-release ]]; then source /etc/os-release; DISTRO=$ID
elif [[ -f /etc/redhat-release ]]; then DISTRO="rhel"
else error "Sistema operativo no soportado"; fi

log "Distro detectada: $DISTRO $VERSION_ID"

# ── Función instalar Docker ──────────────────────────────────────
install_docker() {
    section "Instalando Docker Engine"
    case $DISTRO in
        ubuntu|debian|linuxmint)
            apt-get update -qq
            apt-get install -yq ca-certificates curl gnupg lsb-release
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/$DISTRO/gpg \
                | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
                https://download.docker.com/linux/$DISTRO $(lsb_release -cs) stable" \
                > /etc/apt/sources.list.d/docker.list
            apt-get update -qq
            apt-get install -yq docker-ce docker-ce-cli containerd.io docker-compose-plugin
            ;;
        centos|rhel|fedora|rocky|almalinux)
            yum install -y yum-utils
            yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
            yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
            ;;
        *)
            warn "Distro no reconocida. Instala Docker manualmente: https://docs.docker.com/engine/install/"
            warn "Luego vuelve a ejecutar este script."
            exit 1
            ;;
    esac
    systemctl enable --now docker
    log "Docker instalado correctamente"
}

# ── Verificar Docker ─────────────────────────────────────────────
section "Verificando Dependencias"

if ! command -v docker &>/dev/null; then
    warn "Docker no encontrado."
    read -rp "¿Instalar Docker automáticamente? [S/n]: " resp
    [[ "${resp,,}" != "n" ]] && install_docker || error "Docker es requerido. Instálalo manualmente."
else
    DOCKER_VER=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "desconocida")
    log "Docker encontrado: v$DOCKER_VER"
fi

# Verificar docker compose (plugin v2)
if ! docker compose version &>/dev/null; then
    warn "Docker Compose (plugin) no encontrado. Instalando..."
    apt-get install -yq docker-compose-plugin 2>/dev/null || \
    yum install -y docker-compose-plugin 2>/dev/null || \
    error "No se pudo instalar docker-compose-plugin. Instálalo manualmente."
fi

log "Docker Compose: $(docker compose version --short)"

# ── Crear directorio de instalación ──────────────────────────────
section "Configurando Directorio de Instalación"

mkdir -p "$INSTALL_DIR"
# Copiar archivos del proyecto al directorio de instalación
cp -r ./* "$INSTALL_DIR/" 2>/dev/null || true
cd "$INSTALL_DIR"
log "Directorio: $INSTALL_DIR"

# ── Generar .env ─────────────────────────────────────────────────
section "Configurando Variables de Entorno"

if [[ -f .env ]]; then
    warn ".env ya existe. Omitiendo generación automática."
else
    log "Generando .env con valores seguros..."
    cp .env.example .env

    # Generar contraseñas/secretos aleatorios seguros
    DB_ROOT_PASS=$(openssl rand -hex 24)
    DB_PASS=$(openssl rand -hex 24)
    JWT_SECRET=$(openssl rand -hex 64)
    WORKER_KEY=$(openssl rand -hex 32)

    sed -i "s/CHANGE_ME_ROOT_PASS/$DB_ROOT_PASS/g"   .env
    sed -i "s/CHANGE_ME_DB_PASS/$DB_PASS/g"          .env
    sed -i "s/CHANGE_ME_GENERATE_WITH_OPENSSL_rand_hex_64/$JWT_SECRET/g" .env
    sed -i "s/CHANGE_ME_WORKER_KEY/$WORKER_KEY/g"    .env

    # Solicitar datos de Mikrotik interactivamente
    echo -e "\n${BOLD}Configuración Mikrotik (puedes dejarlos en blanco y editar .env después):${NC}"
    read -rp "  IP del router Mikrotik [192.168.88.1]: " MK_HOST
    read -rp "  Usuario API Mikrotik [admin]: "          MK_USER
    read -rsp "  Contraseña API Mikrotik: "              MK_PASS; echo
    read -rp "  Puerto API Mikrotik [8728]: "            MK_PORT

    [[ -n "$MK_HOST" ]] && sed -i "s/MIKROTIK_HOST=.*/MIKROTIK_HOST=$MK_HOST/" .env
    [[ -n "$MK_USER" ]] && sed -i "s/MIKROTIK_USER=.*/MIKROTIK_USER=$MK_USER/" .env
    [[ -n "$MK_PASS" ]] && sed -i "s/CHANGE_ME_MIKROTIK_PASS/$MK_PASS/"        .env
    [[ -n "$MK_PORT" ]] && sed -i "s/MIKROTIK_PORT=.*/MIKROTIK_PORT=$MK_PORT/" .env

    chmod 600 .env
    log ".env generado con secretos seguros (permisos 600)"
fi

# ── Construir e iniciar contenedores ─────────────────────────────
section "Construyendo e Iniciando Servicios"

log "Descargando imágenes base y construyendo contenedores..."
docker compose pull --ignore-buildable
docker compose build --no-cache

log "Iniciando servicios..."
docker compose up -d

# ── Esperar que la API esté lista ────────────────────────────────
section "Verificando Estado del Sistema"
echo -n "Esperando API core"
for i in {1..30}; do
    if curl -sf http://localhost/api/health &>/dev/null; then
        echo -e " ${GREEN}✓${NC}"
        break
    fi
    echo -n "."
    sleep 3
done

# Mostrar estado final
docker compose ps

# ── Crear servicio systemd para autoarranque ──────────────────────
section "Configurando Autoarranque"

cat > /etc/systemd/system/wisp-system.service << EOF
[Unit]
Description=WISP System (Docker Compose)
Requires=docker.service
After=docker.service network-online.target

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
log "Servicio systemd registrado (autoarranque en boot)"

# ── Resumen final ─────────────────────────────────────────────────
HOST_IP=$(hostname -I | awk '{print $1}')
echo -e "\n${GREEN}${BOLD}"
echo "╔══════════════════════════════════════════════════╗"
echo "║        WISP System instalado exitosamente!       ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Panel Admin:  http://$HOST_IP                   ║"
echo "║  API Docs:     http://$HOST_IP/api/docs          ║"
echo "║  Directorio:   $INSTALL_DIR                      ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Usuario por defecto:  admin                     ║"
echo "║  Contraseña:           (ver .env - WISP_ADMIN_*)  ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"
warn "Edita $INSTALL_DIR/.env para ajustar la configuración."
warn "Para actualizar: cd $INSTALL_DIR && ./scripts/update.sh"
