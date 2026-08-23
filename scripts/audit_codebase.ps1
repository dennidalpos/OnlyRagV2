<#
.SYNOPSIS
    Script di audit architetturale, dipendenze circolari e dead code per OnlyRag V2.
.DESCRIPTION
    Esegue in modo seriale e controllato gli audit con:
    - dpdm: Analisi dei cicli di import (circular dependencies) tra Renderer e Main Process.
    - knip: Scansione di file orfani, export non utilizzati e dipendenze fantasma.
    - skott: Analisi e visualizzazione del grafo di dipendenze (CLI report o Web UI interattiva).
.PARAMETER Mode
    Tipo di audit da eseguire:
    - "All": Esegue sia il controllo cicli (dpdm) che il controllo dead code (knip) che l'analisi grafo (skott).
    - "Cycles": Esegue solo l'analisi delle dipendenze circolari (dpdm).
    - "DeadCode": Esegue solo l'analisi di file orfani ed export inutilizzati (knip).
    - "Graph": Esegue solo l'analisi del grafo di dipendenze (skott).
.PARAMETER WebUI
    Avvia la Web UI interattiva locale di skott su browser per visualizzare il grafo.
.PARAMETER Fast
    Modalità sintetica per l'Agente AI (output conciso PASS/FAIL).
#>

[CmdletBinding()]
param(
    [ValidateSet("All", "Cycles", "DeadCode", "Graph")]
    [string]$Mode = "All",

    [switch]$WebUI = $false,
    [switch]$Fast = $false
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
        Write-Host " OnlyRag V2 - Codebase Architecture & Hygiene Audit" -ForegroundColor Cyan
        Write-Host " Modalità: $Mode | WebUI: $WebUI" -ForegroundColor Yellow
        Write-Host "=====================================================" -ForegroundColor Cyan
    }

    $rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path

    # 1. Analisi Dipendenze Circolari (dpdm)
    if ($Mode -eq "All" -or $Mode -eq "Cycles") {
        if (-not $Fast) {
            Write-Host "`n[1/3] Analisi delle dipendenze circolari (dpdm)..." -ForegroundColor Yellow
        }
        npx dpdm --circular --warning=false src/main.tsx electron/main.ts
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[WARN] Rilevati avvisi durante l'analisi dpdm." -ForegroundColor Yellow
        } else {
            if (-not $Fast) { Write-Host "[OK] Scansione dipendenze circolari dpdm completata." -ForegroundColor Green }
        }
    }

    # 2. Analisi Dead Code, Export Inutilizzati e File Orfani (knip)
    if ($Mode -eq "All" -or $Mode -eq "DeadCode") {
        if (-not $Fast) {
            Write-Host "`n[2/3] Analisi di dead code e file orfani (knip)..." -ForegroundColor Yellow
        }
        npx knip --no-exit-code
        if (-not $Fast) { Write-Host "[OK] Scansione dead code knip completata." -ForegroundColor Green }
    }

    # 3. Analisi Grafo delle Dipendenze (skott)
    if ($Mode -eq "All" -or $Mode -eq "Graph") {
        if ($WebUI) {
            Write-Host "`n[3/3] Avvio Web UI interattiva del grafo di dipendenze (skott)..." -ForegroundColor Cyan
            npx skott src/main.tsx electron/main.ts --displayMode=webapp
        } else {
            if (-not $Fast) {
                Write-Host "`n[3/3] Analisi grafo di dipendenze (skott)..." -ForegroundColor Yellow
            }
            npx skott src/main.tsx electron/main.ts --displayMode=file-tree
            if (-not $Fast) { Write-Host "[OK] Analisi grafo skott completata." -ForegroundColor Green }
        }
    }

    if ($Fast) {
        Write-Host "[PASS] Codebase audit completed successfully ($Mode mode)." -ForegroundColor Green
    } else {
        Write-Host "`n=====================================================" -ForegroundColor Green
        Write-Host " AUDIT ARCHITETTURA & CODE HYGIENE COMPLETATO!" -ForegroundColor Green
        Write-Host "=====================================================" -ForegroundColor Green
    }
    exit 0
} catch {
    Write-Host "`n[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
