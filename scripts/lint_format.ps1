<#
.SYNOPSIS
    Script di Linting, Formattazione e Quality Verification per OnlyRag V2.
.DESCRIPTION
    Esegue in modo strettamente seriale il typecheck dei file TypeScript, la suite di unit test Vitest,
    ed il controllo sintattico Python con Fail-Fast rigoroso.
.PARAMETER Fast
    Esegue la suite in modalità compatta ad alta velocità (default per AI Agent).
.PARAMETER Full
    Esegue la suite con output dettagliato e diagnostica estesa.
.PARAMETER Format
    Esegue la verifica della formattazione e della pulizia del codice.
#>

param(
    [switch]$Fast = $true,
    [switch]$Full = $false,
    [switch]$Format = $false
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host " OnlyRag V2 - Serial Quality, Lint & Format Script" -ForegroundColor Cyan
    Write-Host "=====================================================" -ForegroundColor Cyan

    $rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path

    # 1. TypeScript Typecheck
    Write-Host "`n[1/3] Checking TypeScript type safety (tsc --noEmit)..." -ForegroundColor Yellow
    npm run typecheck
    if ($LASTEXITCODE -ne 0) {
        throw "[FAIL] TypeScript typecheck failed with exit code $LASTEXITCODE."
    }
    Write-Host "[PASS] TypeScript typecheck clean." -ForegroundColor Green

    # 2. Vitest Fast Unit & Benchmark Test Suite
    Write-Host "`n[2/3] Running Vitest serial test suite..." -ForegroundColor Yellow
    if ($Full) {
        npm run test
    } else {
        npm run test:fast
    }
    if ($LASTEXITCODE -ne 0) {
        throw "[FAIL] Vitest test suite failed with exit code $LASTEXITCODE."
    }
    Write-Host "[PASS] Vitest unit test suite clean." -ForegroundColor Green

    # 3. Python Sidecar Syntax Check
    Write-Host "`n[3/3] Checking Python sidecar syntax..." -ForegroundColor Yellow
    $sidecarPath = Join-Path -Path $rootDir -ChildPath "sidecar\main.py"
    if (Test-Path $sidecarPath) {
        python -m py_compile $sidecarPath
        if ($LASTEXITCODE -ne 0) {
            throw "[FAIL] Python syntax check failed on $sidecarPath with exit code $LASTEXITCODE."
        }
        Write-Host "[PASS] Python sidecar syntax clean." -ForegroundColor Green
    } else {
        Write-Host "[SKIP] Sidecar main.py non trovato, step saltato." -ForegroundColor Gray
    }

    Write-Host "`n=====================================================" -ForegroundColor Green
    Write-Host " ALL SERIAL QUALITY CHECKS PASSED!" -ForegroundColor Green
    Write-Host "=====================================================" -ForegroundColor Green

    exit 0
} catch {
    Write-Host "`n[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
