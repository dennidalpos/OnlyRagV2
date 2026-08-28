<#
.SYNOPSIS
    Script di pulizia repository, dati locali e log per OnlyRag V2 con Fail-Fast rigoroso.
.DESCRIPTION
    Consente di eseguire la pulizia dei file temporanei, delle cache di build, dei dati locali (AppData)
    e/o dei log dell'applicazione (sia in sviluppo sia dell'app installata).
.PARAMETER Mode
    Tipo di pulizia:
    - "Repo": Pulisce le cartelle di build (dist, build, pycache, sidecar_dist) mantenendo i dati utente.
    - "Logs": Pulisce tutti i log applicativi (%APPDATA%\onlyrag-v2\logs, %LOCALAPPDATA%\OnlyRagV2\logs, audit log, sidecar log).
    - "UserData": Pulisce i dati locali dell'applicazione su PC (%LOCALAPPDATA%\OnlyRagV2, LanceDB, log, export, settings).
    - "Full": Esegue una pulizia completa di repository, dati locali e log dell'applicazione.
.PARAMETER CleanLogs
    Switch opzionale per forzare la pulizia dei log applicativi anche in modalità Repo.
.PARAMETER Fast
    Modalità sintetica per l'Agente AI (output conciso PASS/FAIL).
.PARAMETER StopAppProcesses
    Arresta solo i processi identificabili di OnlyRag V2 prima della pulizia dei log.
    Per sicurezza non termina più processi generici Python o Electron.
#>

[CmdletBinding()]
param(
    [ValidateSet("Repo", "UserData", "Logs", "Full")]
    [string]$Mode = "Repo",

    [switch]$CleanLogs = $false,
    [switch]$Fast = $false,
    [switch]$StopAppProcesses = $false
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

    # 1. Arresto opzionale dei soli processi OnlyRag V2 identificabili
    if (-not $Fast) {
        Write-Host "`n[1/4] Verifica processi applicativi in corso..." -ForegroundColor Yellow
    }
    if ($StopAppProcesses) {
        try {
            $runningProcesses = Get-Process -Name "OnlyRag V2", "sidecar" -ErrorAction SilentlyContinue
            if ($runningProcesses) {
                if (-not $Fast) {
                    Write-Host "Arresto di $($runningProcesses.Count) processo/i OnlyRag V2..." -ForegroundColor Gray
                }
                $runningProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
            }
            if (-not $Fast) { Write-Host "[OK] Processi OnlyRag V2 verificati." -ForegroundColor Green }
        } catch {
            if (-not $Fast) { Write-Host "[WARN] Impossibile arrestare un processo OnlyRag V2: $($_.Exception.Message)" -ForegroundColor Yellow }
        }
    } elseif (-not $Fast) {
        Write-Host "[OK] Nessun processo arrestato (usa -StopAppProcesses se necessario)." -ForegroundColor Gray
    }

    # 2. Pulizia Log Applicativi (App installata, AppData e dev)
    if ($Mode -eq "Logs" -or $Mode -eq "UserData" -or $Mode -eq "Full" -or $CleanLogs) {
        if (-not $Fast) {
            Write-Host "`n[2/4] Pulizia di tutti i file di log applicativi (sviluppo e app installata)..." -ForegroundColor Yellow
        }

        $logDirs = @(
            (Join-Path $env:APPDATA "onlyrag-v2\logs"),
            (Join-Path $env:LOCALAPPDATA "OnlyRagV2\logs"),
            (Join-Path $env:USERPROFILE ".onlyragv2\logs"),
            (Join-Path $env:USERPROFILE ".onlyrag_v2\logs"),
            (Join-Path $rootDir "logs"),
            (Join-Path $rootDir "userdata_dev\logs")
        )

        foreach ($logDir in $logDirs) {
            if (Test-Path $logDir) {
                if (-not $Fast) { Write-Host "Svuotamento directory log: $logDir" -ForegroundColor Gray }
                Get-ChildItem -Path $logDir -File -Filter "*.log*" -Force -ErrorAction SilentlyContinue | ForEach-Object {
                    Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
                }
                # Rimuovi eventuali file residui nella cartella log
                Get-ChildItem -Path $logDir -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
                    Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
                }
            }
        }

        # Pulizia log temporanei in TEMP
        Get-ChildItem -Path $env:TEMP -Filter "onlyrag*.log" -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
            Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
        }

        if (-not $Fast) { Write-Host "[OK] Log applicativi ripuliti con successo." -ForegroundColor Green }
    }

    # 3. Pulizia Artifact di Build & Cache nel Repository
    if ($Mode -eq "Repo" -or $Mode -eq "Full") {
        if (-not $Fast) {
            Write-Host "`n[3/4] Pulizia cache ed artifact di build nel repository..." -ForegroundColor Yellow
        }

        # Cartelle target da rimuovere nel repository
        $targetsRepo = @(
            (Join-Path $rootDir "build"),
            (Join-Path $rootDir "dist"),
            (Join-Path $rootDir "dist-electron"),
            (Join-Path $rootDir "out"),
            (Join-Path $rootDir "release"),
            (Join-Path $rootDir "sidecar_dist"),
            (Join-Path $rootDir "scripts\build"),
            (Join-Path $rootDir "scripts\dist"),
            (Join-Path $rootDir "node_modules\.vite"),
            (Join-Path $rootDir "node_modules\.cache"),
            (Join-Path $rootDir ".vite"),
            (Join-Path $rootDir ".pytest_cache"),
            (Join-Path $rootDir "sidecar\.pytest_cache"),
            (Join-Path $rootDir "coverage"),
            (Join-Path $rootDir ".nyc_output"),
            (Join-Path $rootDir "test-results"),
            (Join-Path $rootDir "htmlcov"),
            (Join-Path $rootDir "logs"),
            (Join-Path $rootDir ".onlyrag"),
            (Join-Path $rootDir "userdata_dev"),
            (Join-Path $rootDir "lancedb_store"),
            (Join-Path $rootDir "export"),
            (Join-Path $rootDir "data")
        )

        foreach ($target in $targetsRepo) {
            if (Test-Path $target) {
                if (-not $Fast) { Write-Host "Rimuovendo: $target" -ForegroundColor Gray }
                Remove-Item -Path $target -Recurse -Force -ErrorAction SilentlyContinue
            }
        }

        # Scansione mirata per file temporanei e cartelle di cache ricorsive (escludendo .venv, node_modules e .git)
        $searchDirs = Get-ChildItem -Path $rootDir -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notin @(".venv", "venv", "env", "node_modules", ".git") } |
            ForEach-Object { $_.FullName }

        $filePatterns = @("*.pyc", "*.pyo", "*.pyd", "*.tsbuildinfo", "*.log", "*.log.*", "*.tmp", "*.temp", "Thumbs.db", "ehthumbs.db", "desktop.ini", ".DS_Store", "gemini-code-*.txt", ".coverage", ".coverage.*")

        # Rimuovi file sporchi nella cartella radice
        Get-ChildItem -Path $rootDir -File -Include $filePatterns -Force -ErrorAction SilentlyContinue | ForEach-Object {
            Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
        }

        # Rimuovi file sporchi e cartelle di cache ricorsivamente
        foreach ($dir in $searchDirs) {
            Get-ChildItem -Path $dir -Recurse -File -Include $filePatterns -Force -ErrorAction SilentlyContinue | ForEach-Object {
                Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
            }
            Get-ChildItem -Path $dir -Recurse -Directory -Filter "__pycache__" -Force -ErrorAction SilentlyContinue | ForEach-Object {
                Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
            Get-ChildItem -Path $dir -Recurse -Directory -Filter ".pytest_cache" -Force -ErrorAction SilentlyContinue | ForEach-Object {
                Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
            Get-ChildItem -Path $dir -Recurse -Directory -Filter "*.egg-info" -Force -ErrorAction SilentlyContinue | ForEach-Object {
                Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
        }

        if (-not $Fast) { Write-Host "[OK] Pulizia repository completata." -ForegroundColor Green }
    }

    # 4. Pulizia Dati Utente Locali su PC (AppData, LanceDB Store, Impostazioni, Export)
    if ($Mode -eq "UserData" -or $Mode -eq "Full") {
        if (-not $Fast) {
            Write-Host "`n[4/4] Pulizia dati locali utente su PC (AppData)..." -ForegroundColor Yellow
        }

        $localAppData = $env:LOCALAPPDATA
        $roamingAppData = $env:APPDATA

        $targetsUserData = @(
            (Join-Path $localAppData "OnlyRagV2"),
            (Join-Path $roamingAppData "onlyrag-v2"),
            (Join-Path $env:USERPROFILE ".onlyragv2"),
            (Join-Path $env:USERPROFILE ".onlyrag_v2")
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
