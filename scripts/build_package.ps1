<#
.SYNOPSIS
    Script di build e packaging NSIS per OnlyRag V2 con Fail-Fast rigoroso.
.DESCRIPTION
    Esegue il typecheck TypeScript, compila i moduli Vite/Electron e genera l'installer NSIS di produzione.
#>

param(
    [switch]$SkipSidecar = $false
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host " OnlyRag V2 - Build & NSIS Packaging Script" -ForegroundColor Cyan
    Write-Host "=====================================================" -ForegroundColor Cyan

    # 1. Verifica Tipo & Sintassi TypeScript
    Write-Host "`n[1/4] Esecuzione TypeScript Typecheck..." -ForegroundColor Yellow
    npm run typecheck
    if ($LASTEXITCODE -ne 0) {
        throw "[ERRORE] Typecheck fallito con codice di uscita $LASTEXITCODE. Interruzione immediata."
    }
    Write-Host "[OK] Typecheck superato con successo." -ForegroundColor Green

    # 2. Compilazione PyInstaller Standalone Executable per Sidecar Python
    Write-Host "`n[2/4] Compilazione PyInstaller Standalone Executable per Sidecar Python..." -ForegroundColor Yellow
    $rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path
    $venvPyInstaller = Join-Path -Path $rootDir -ChildPath ".venv\Scripts\pyinstaller.exe"
    $sidecarScript = Join-Path -Path $rootDir -ChildPath "sidecar\main.py"

    if (-not $SkipSidecar -and (Test-Path $venvPyInstaller)) {
        & $venvPyInstaller --noconfirm "$rootDir\sidecar.spec"
        if ($LASTEXITCODE -ne 0) {
            throw "[ERRORE] Compilazione PyInstaller Sidecar fallita con codice $LASTEXITCODE."
        }
        Write-Host "[OK] Standalone sidecar.exe generato con successo in sidecar_dist/sidecar." -ForegroundColor Green
    } else {
        Write-Host "[WARN] PyInstaller non trovato in .venv o flag SkipSidecar attivo. L'installer utilizzerà l'auto-installer dinamico Python." -ForegroundColor Yellow
    }

    # 3. Compilazione Build & Packaging NSIS tramite electron-builder
    Write-Host "`n[3/4] Avvio build Vite + Electron ed impacchettamento NSIS (electron-builder)..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "[ERRORE] Build o impacchettamento NSIS fallito con codice di uscita $LASTEXITCODE. Interruzione immediata."
    }
    Write-Host "[OK] Compilazione ed impacchettamento completati." -ForegroundColor Green

    # 4. Validazione Artifact NSIS generati
    Write-Host "`n[4/4] Verifica degli artifact di installazione NSIS in dist/..." -ForegroundColor Yellow
    $distPath = Join-Path -Path $PSScriptRoot -ChildPath "..\dist"
    $nsisInstaller = Get-ChildItem -Path $distPath -Filter "*.exe" | Where-Object { $_.Name -like "*Setup*.exe" } | Select-Object -First 1

    if ($null -eq $nsisInstaller) {
        throw "[ERRORE] Nessun installer NSIS (*Setup*.exe) trovato nella cartella dist! Interruzione immediata."
    }

    $sizeMB = [math]::Round($nsisInstaller.Length / 1MB, 2)
    Write-Host "`n=====================================================" -ForegroundColor Green
    Write-Host " PACKAGING NSIS COMPLETATO CON SUCCESSO!" -ForegroundColor Green
    Write-Host " File: $($nsisInstaller.FullName)" -ForegroundColor White
    Write-Host " Dimensione: $sizeMB MB" -ForegroundColor White
    Write-Host "=====================================================" -ForegroundColor Green

    exit 0
} catch {
    Write-Host "`n[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
