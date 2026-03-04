#Requires -Version 5.1
# ================================================================
#  WISP System - Script de Actualización (Windows)
#  Uso: .\scripts\update.ps1
# ================================================================

param([switch]$SkipBackup)

Set-Location (Split-Path $PSScriptRoot)

function Write-Step  { Write-Host "`n=== $args ===" -ForegroundColor Cyan }
function Write-OK    { Write-Host "[OK] $args"      -ForegroundColor Green }
function Write-Warn  { Write-Host "[!]  $args"      -ForegroundColor Yellow }
function Write-Fail  { Write-Host "[X]  $args"      -ForegroundColor Red; exit 1 }

Write-Step "WISP System - Actualización $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# ── Backup de BD ────────────────────────────────────────────────
if (-not $SkipBackup) {
    Write-Step "Backup de Base de Datos"
    
    $backupDir = ".\backups"
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory $backupDir | Out-Null }
    $backupFile = "$backupDir\wisp_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql.gz"

    # Leer variables de .env
    $envVars = Get-Content .env | Where-Object { $_ -match '=' -and $_ -notmatch '^#' } |
               ForEach-Object { $k, $v = $_ -split '=', 2; @{ $k.Trim() = $v.Trim() } }
    $envHash = @{}; $envVars | ForEach-Object { $envHash += $_ }

    Write-Warn "Creando backup: $backupFile"
    docker compose exec -T db mysqldump `
        "-u$($envHash.DB_USER)" "-p$($envHash.DB_PASSWORD)" `
        --single-transaction --routines --triggers `
        $envHash.DB_NAME | Out-File -Encoding utf8 "$backupFile.sql"
    
    # Comprimir con PowerShell si está disponible
    try {
        Compress-Archive -Path "$backupFile.sql" -DestinationPath $backupFile -Force
        Remove-Item "$backupFile.sql"
        Write-OK "Backup: $backupFile"
    } catch {
        Write-Warn "No se pudo comprimir. Backup en: $backupFile.sql"
    }

    # Mantener solo los últimos 10 backups
    Get-ChildItem $backupDir -Filter "wisp_backup_*" |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 |
        Remove-Item -Force
}

# ── Nueva versión ───────────────────────────────────────────────
Write-Step "Obteniendo Nueva Versión"

if (Test-Path ".git") {
    $currentCommit = git rev-parse HEAD
    git stash 2>$null
    git pull origin main
    $newCommit = git rev-parse HEAD
    
    if ($currentCommit -eq $newCommit) {
        Write-Warn "Sin cambios. El sistema ya está actualizado."
        exit 0
    }
    Write-OK "Actualizado a commit: $newCommit"
} else {
    Write-Warn "Descargando imágenes Docker actualizadas..."
    docker compose pull --ignore-buildable
}

# ── Build ────────────────────────────────────────────────────────
Write-Step "Reconstruyendo Contenedores"
docker compose build
if ($LASTEXITCODE -ne 0) { Write-Fail "Error en build." }

# ── Migraciones ──────────────────────────────────────────────────
Write-Step "Migraciones de Base de Datos"
docker compose run --rm api-core node src/migrations/runner.js
if ($LASTEXITCODE -ne 0) { Write-Fail "Error en migraciones." }
Write-OK "Migraciones completadas."

# ── Reiniciar servicios ──────────────────────────────────────────
Write-Step "Reiniciando Servicios"
docker compose stop mikrotik-worker
docker compose up -d --no-deps api-core

# Esperar API
Write-Host "Esperando API" -NoNewline
for ($i = 0; $i -lt 12; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost/api/health" -UseBasicParsing -TimeoutSec 2 -EA Stop
        if ($r.StatusCode -eq 200) { Write-Host " OK" -ForegroundColor Green; break }
    } catch {}
    Write-Host "." -NoNewline
    Start-Sleep 5
}

docker compose up -d --no-deps web-ui nginx mikrotik-worker

# ── Estado final ─────────────────────────────────────────────────
Write-Step "Estado Post-Actualización"
docker compose ps
Write-Host "`n[OK] Actualización completada." -ForegroundColor Green
