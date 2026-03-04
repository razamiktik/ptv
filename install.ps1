#Requires -Version 5.1
<#
.SYNOPSIS
    WISP System - Instalador para Windows 10/11/Server
.DESCRIPTION
    Detecta Docker Desktop, configura variables de entorno e inicia el sistema WISP.
.EXAMPLE
    # Ejecutar en PowerShell como Administrador:
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
    .\install.ps1
#>

param(
    [string]$InstallDir = "C:\wisp-system",
    [switch]$Force
)

# ── Verificar Administrador ──────────────────────────────────────
$currentPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[!] Reiniciando con privilegios de administrador..." -ForegroundColor Yellow
    Start-Process PowerShell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

# ── Helpers ──────────────────────────────────────────────────────
function Write-Step  { Write-Host "`n=== $args ===" -ForegroundColor Cyan }
function Write-OK    { Write-Host "[OK] $args" -ForegroundColor Green }
function Write-Warn  { Write-Host "[!]  $args" -ForegroundColor Yellow }
function Write-Fail  { Write-Host "[X]  $args" -ForegroundColor Red; exit 1 }

# ── Banner ───────────────────────────────────────────────────────
Write-Host @"
 ██╗    ██╗██╗███████╗██████╗
 ██║    ██║██║██╔════╝██╔══██╗
 ██║ █╗ ██║██║███████╗██████╔╝
 ██║███╗██║██║╚════██║██╔═══╝
 ╚███╔███╔╝██║███████║██║
  ╚══╝╚══╝ ╚═╝╚══════╝╚═╝  Sistema WISP v1.0
"@ -ForegroundColor Cyan

# ── Verificar versión de Windows ─────────────────────────────────
Write-Step "Verificando Sistema Operativo"
$osInfo = Get-ComputerInfo -Property OsName, OsVersion
Write-OK "SO: $($osInfo.OsName)"

$winBuild = [System.Environment]::OSVersion.Version.Build
if ($winBuild -lt 19041) {
    Write-Warn "Windows 10 versión 2004+ recomendado para WSL2. Build actual: $winBuild"
}

# ── Verificar/Instalar Docker ────────────────────────────────────
Write-Step "Verificando Docker Desktop"

$dockerPath = Get-Command "docker" -ErrorAction SilentlyContinue

if (-not $dockerPath) {
    Write-Warn "Docker Desktop no encontrado."
    $installDocker = Read-Host "¿Descargar e instalar Docker Desktop automáticamente? [S/n]"
    
    if ($installDocker -ne 'n') {
        Write-Warn "Descargando Docker Desktop (puede tardar varios minutos)..."
        $dockerInstaller = "$env:TEMP\DockerDesktopInstaller.exe"
        $dockerUrl = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
        
        try {
            # Usar BITS para descarga en background
            Start-BitsTransfer -Source $dockerUrl -Destination $dockerInstaller -Description "Descargando Docker Desktop"
            Write-OK "Docker Desktop descargado."
            Write-Warn "Iniciando instalador... (requiere reinicio al finalizar)"
            Start-Process -FilePath $dockerInstaller -ArgumentList "install --quiet" -Wait
            Write-Warn "REINICIA EL SISTEMA y vuelve a ejecutar este instalador."
            Pause
            exit 0
        }
        catch {
            Write-Warn "Descarga automática falló. Instala Docker Desktop manualmente:"
            Write-Host "  https://www.docker.com/products/docker-desktop/" -ForegroundColor Blue
            Write-Fail "Docker Desktop es requerido para continuar."
        }
    }
    else {
        Write-Fail "Docker Desktop es requerido. Instálalo desde: https://www.docker.com/products/docker-desktop/"
    }
}

$dockerVersion = (docker version --format "{{.Server.Version}}" 2>$null)
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Docker está instalado pero no está corriendo. Inicia Docker Desktop y vuelve a intentarlo."
}
Write-OK "Docker Engine: v$dockerVersion"

$composeVersion = (docker compose version --short 2>$null)
Write-OK "Docker Compose: v$composeVersion"

# ── Crear directorio de instalación ──────────────────────────────
Write-Step "Configurando Directorio de Instalación"

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Copiar archivos del proyecto
Copy-Item -Path ".\*" -Destination $InstallDir -Recurse -Force -Exclude ".git","node_modules"
Set-Location $InstallDir
Write-OK "Directorio: $InstallDir"

# ── Generar .env ─────────────────────────────────────────────────
Write-Step "Configurando Variables de Entorno"

if ((Test-Path "$InstallDir\.env") -and (-not $Force)) {
    Write-Warn ".env ya existe. Usa -Force para regenerar."
}
else {
    Write-OK "Generando .env con claves seguras..."
    Copy-Item ".env.example" ".env" -Force

    # Función para generar hex random
    function New-SecureHex([int]$bytes) {
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $buf = New-Object byte[] $bytes
        $rng.GetBytes($buf)
        return [BitConverter]::ToString($buf).Replace("-", "").ToLower()
    }

    $dbRootPass = New-SecureHex 24
    $dbPass     = New-SecureHex 24
    $jwtSecret  = New-SecureHex 64
    $workerKey  = New-SecureHex 32

    # Reemplazar valores en .env
    (Get-Content .env) `
        -replace "CHANGE_ME_ROOT_PASS",                          $dbRootPass `
        -replace "CHANGE_ME_DB_PASS",                            $dbPass     `
        -replace "CHANGE_ME_GENERATE_WITH_OPENSSL_rand_hex_64",  $jwtSecret  `
        -replace "CHANGE_ME_WORKER_KEY",                         $workerKey  |
    Set-Content .env

    # Solicitar datos de Mikrotik
    Write-Host "`nConfiguración Mikrotik (Enter para omitir y editar .env después):" -ForegroundColor White
    $mkHost = Read-Host "  IP del router Mikrotik [192.168.88.1]"
    $mkUser = Read-Host "  Usuario API [admin]"
    $mkPassSec = Read-Host "  Contraseña API" -AsSecureString
    $mkPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($mkPassSec))
    $mkPort = Read-Host "  Puerto API [8728]"

    if ($mkHost) { (Get-Content .env) -replace "MIKROTIK_HOST=.*", "MIKROTIK_HOST=$mkHost" | Set-Content .env }
    if ($mkUser) { (Get-Content .env) -replace "MIKROTIK_USER=.*", "MIKROTIK_USER=$mkUser" | Set-Content .env }
    if ($mkPass) { (Get-Content .env) -replace "CHANGE_ME_MIKROTIK_PASS", $mkPass | Set-Content .env }
    if ($mkPort) { (Get-Content .env) -replace "MIKROTIK_PORT=.*", "MIKROTIK_PORT=$mkPort" | Set-Content .env }

    Write-OK ".env generado correctamente."
}

# ── Construir e iniciar ───────────────────────────────────────────
Write-Step "Construyendo e Iniciando Servicios Docker"
Set-Location $InstallDir

docker compose pull --ignore-buildable
if ($LASTEXITCODE -ne 0) { Write-Warn "Pull parcialmente fallido, continuando..." }

docker compose build --no-cache
if ($LASTEXITCODE -ne 0) { Write-Fail "Error al construir los contenedores." }

docker compose up -d
if ($LASTEXITCODE -ne 0) { Write-Fail "Error al iniciar los contenedores." }

# ── Esperar API ───────────────────────────────────────────────────
Write-Host "`nEsperando que la API inicie" -NoNewline
for ($i = 0; $i -lt 30; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost/api/health" -UseBasicParsing -TimeoutSec 2 -EA Stop
        if ($response.StatusCode -eq 200) { Write-Host " OK" -ForegroundColor Green; break }
    } catch {}
    Write-Host "." -NoNewline
    Start-Sleep 3
}

docker compose ps

# ── Registrar como Servicio de Windows ───────────────────────────
Write-Step "Configurando Autoarranque (Tarea Programada)"

$action  = New-ScheduledTaskAction -Execute "docker" -Argument "compose -f `"$InstallDir\docker-compose.yml`" up -d" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -RestartCount 3
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName "WISPSystem-AutoStart" `
    -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Force | Out-Null
Write-OK "Tarea programada 'WISPSystem-AutoStart' registrada."

# ── Resumen ───────────────────────────────────────────────────────
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne "127.0.0.1" } | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║     WISP System instalado exitosamente!          ║" -ForegroundColor Green
Write-Host "╠══════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "║  Panel Admin:  http://$localIP               ║" -ForegroundColor Green
Write-Host "║  API Docs:     http://$localIP/api/docs      ║" -ForegroundColor Green
Write-Host "║  Directorio:   $InstallDir            ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Warn "Edita $InstallDir\.env para ajustar la configuración."
Write-Warn "Para actualizar: cd $InstallDir; .\scripts\update.ps1"
