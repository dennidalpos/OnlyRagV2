<#
.SYNOPSIS
    Script di pulizia repository e dati locali per OnlyRag V2 con Fail-Fast rigoroso.
.DESCRIPTION
    Consente di eseguire la pulizia dei file temporanei, delle cache di build e/o del database vettoriale locale (AppData).
.PARAMETER Mode
    Tipo di pulizia:
    - "Repo": Pulisce le cartelle di build (dist, build, pycache, sidecar_dist) mantenendo i dati utente.
    - "UserData": Pulisce i dati locali dell'applicazione su PC (%LOCALAPPDATA%\OnlyRagV2, LanceDB, log, export).
    - "Full": Esegue una pulizia completa sia del repository che dei dati locali dell'applicazione.
.PARAMETER Fast
    Modalità sintetica per l'Agente AI (output conciso PASS/FAIL).
#>

[CmdletBinding()]
param(
    [ValidateSet("Repo", "UserData", "Full")]
    [string]$Mode = "Repo",

    [switch]$Fast
)

$ErrorActionPreference = "Stop"
if (Test-Path Variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $true
}
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    if (-not $Fast) {
        Write-Host "=====================================================" -ForegroundColor Cyan
        Write-Host " OnlyRag V2 - Workspace & Local Data Cleanup Utility" -ForegroundColor Cyan
        Write-Host " Modalità Selezionata: $Mode" -ForegroundColor Yellow
        Write-Host "=====================================================" -ForegroundColor Cyan
    }

    $rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path

    # 1. Arresto processi Sidecar o Python pendenti
    if (-not $Fast) {
        Write-Host "`n[1/3] Verifica e arresto dei processi Sidecar in corso..." -ForegroundColor Yellow
    }
    try {
        $runningProcesses = Get-Process -Name "sidecar", "python" -ErrorAction SilentlyContinue
        if ($runningProcesses) {
            if (-not $Fast) {
                Write-Host "Arresto di $($runningProcesses.Count) processi in corso..." -ForegroundColor Gray
            }
            $runningProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
        }
        if (-not $Fast) { Write-Host "[OK] Processi verificati." -ForegroundColor Green }
    } catch {
        if (-not $Fast) { Write-Host "[WARN] Nessun processo da arrestare." -ForegroundColor Gray }
    }

    # 2. Pulizia Artifact di Build & Cache nel Repository
    if ($Mode -eq "Repo" -or $Mode -eq "Full") {
        if (-not $Fast) {
            Write-Host "`n[2/3] Pulizia cache ed artifact di build nel repository..." -ForegroundColor Yellow
        }

        $targetsRepo = @(
            (Join-Path $rootDir "build"),
            (Join-Path $rootDir "dist"),
            (Join-Path $rootDir "dist-electron"),
            (Join-Path $rootDir "out"),
            (Join-Path $rootDir "sidecar_dist"),
            (Join-Path $rootDir "sidecar\__pycache__"),
            (Join-Path $rootDir "scripts\build"),
            (Join-Path $rootDir "scripts\dist"),
            (Join-Path $rootDir "node_modules\.vite"),
            (Join-Path $rootDir ".pytest_cache"),
            (Join-Path $rootDir ".tsbuildinfo")
        )

        foreach ($target in $targetsRepo) {
            if (Test-Path $target) {
                if (-not $Fast) { Write-Host "Rimuovendo: $target" -ForegroundColor Gray }
                Remove-Item -Path $target -Recurse -Force -ErrorAction SilentlyContinue
            }
        }

        # Pulizia file temporanei di cache e log
        Get-ChildItem -Path $rootDir -Recurse -Include "*.pyc", "gemini-code-*.txt", "Thumbs.db" -ErrorAction SilentlyContinue | ForEach-Object {
            Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
        }

        # Pulizia cartelle __pycache__ ricorsive
        Get-ChildItem -Path (Join-Path $rootDir "sidecar") -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue | ForEach-Object {
            Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }

        if (-not $Fast) { Write-Host "[OK] Pulizia repository completata." -ForegroundColor Green }
    }

    # 3. Pulizia Dati Utente Locali su PC (AppData, LanceDB Store, Log, Export)
    if ($Mode -eq "UserData" -or $Mode -eq "Full") {
        if (-not $Fast) {
            Write-Host "`n[3/3] Pulizia dati locali utente su PC (AppData)..." -ForegroundColor Yellow
        }

        $localAppData = $env:LOCALAPPDATA
        $roamingAppData = $env:APPDATA

        $targetsUserData = @(
            (Join-Path $localAppData "OnlyRagV2"),
            (Join-Path $roamingAppData "onlyrag-v2"),
            (Join-Path $env:USERPROFILE ".onlyragv2")
        )

        foreach ($userDataPath in $targetsUserData) {
            if (Test-Path $userDataPath) {
                if (-not $Fast) { Write-Host "Rimuovendo dati utente: $userDataPath" -ForegroundColor Gray }
                Remove-Item -Path $userDataPath -Recurse -Force -ErrorAction SilentlyContinue
            }
        }

        if (-not $Fast) { Write-Host "[OK] Pulizia dati utente locali completata." -ForegroundColor Green }
    }

    if ($Fast) {
        Write-Host "[PASS] Workspace clean ($Mode mode)." -ForegroundColor Green
    } else {
        Write-Host "`n=====================================================" -ForegroundColor Cyan
        Write-Host " OPERAZIONE DI PULIZIA COMPLETATA CON SUCCESSO!" -ForegroundColor Green
        Write-Host "=====================================================" -ForegroundColor Cyan
    }
    exit 0
} catch {
    Write-Host "`n[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
