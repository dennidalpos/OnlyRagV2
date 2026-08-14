<#
.SYNOPSIS
    Script di Linting, Formattazione e Quality Verification per OnlyRag V2.
.DESCRIPTION
    Esegue in modo strettamente seriale il typecheck dei file TypeScript, la validazione sintattica
    di tutti i file Python nel sidecar, la verifica dei file JSON di configurazione e la suite di test Vitest
    con gestione rigorosa del Fail-Fast e codifica UTF-8.
.PARAMETER Fast
    Esegue la suite in modalità compatta ad alta velocità (default per AI Agent).
.PARAMETER Full
    Esegue la suite con output dettagliato e diagnostica estesa.
.PARAMETER Format
    Esegue la verifica della sintassi JSON e della pulizia del workspace.
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

    # 1. JSON Configuration Syntax Check (if -Format or default)
    Write-Host "`n[1/4] Validating JSON configurations..." -ForegroundColor Yellow
    $jsonFiles = @("package.json", "tsconfig.json", "PROJECT_STATUS.json")
    foreach ($jf in $jsonFiles) {
        $jPath = Join-Path -Path $rootDir -ChildPath $jf
        if (Test-Path $jPath) {
            try {
                $null = Get-Content -Raw -Path $jPath | ConvertFrom-Json
                Write-Host "  [OK] $jf valid." -ForegroundColor DarkGray
            } catch {
                throw "[FAIL] Invalid JSON syntax in $($jf): $($_.Exception.Message)"
            }
        }
    }
    Write-Host "[PASS] JSON configurations valid." -ForegroundColor Green

    # 2. TypeScript Typecheck
    Write-Host "`n[2/4] Checking TypeScript type safety (tsc --noEmit)..." -ForegroundColor Yellow
    npm run typecheck
    if ($LASTEXITCODE -ne 0) {
        throw "[FAIL] TypeScript typecheck failed with exit code $LASTEXITCODE."
    }
    Write-Host "[PASS] TypeScript typecheck clean." -ForegroundColor Green

    # 3. Python Sidecar Syntax Check (All .py files in sidecar)
    Write-Host "`n[3/4] Checking Python sidecar syntax..." -ForegroundColor Yellow
    $sidecarDir = Join-Path -Path $rootDir -ChildPath "sidecar"
    if (Test-Path $sidecarDir) {
        $pyFiles = Get-ChildItem -Path $sidecarDir -Filter "*.py" -Recurse
        foreach ($py in $pyFiles) {
            python -m py_compile $py.FullName
            if ($LASTEXITCODE -ne 0) {
                throw "[FAIL] Python syntax check failed on $($py.FullName) with exit code $LASTEXITCODE."
            }
        }
        Write-Host "[PASS] Python sidecar ($($pyFiles.Count) files) syntax clean." -ForegroundColor Green
    } else {
        Write-Host "[SKIP] Sidecar directory non trovata, step saltato." -ForegroundColor Gray
    }

    # 4. Vitest Fast Unit & Benchmark Test Suite
    Write-Host "`n[4/4] Running Vitest serial test suite..." -ForegroundColor Yellow
    if ($Full) {
        npm run test
    } else {
        npm run test:fast
    }
    if ($LASTEXITCODE -ne 0) {
        throw "[FAIL] Vitest test suite failed with exit code $LASTEXITCODE."
    }
    Write-Host "[PASS] Vitest unit test suite clean." -ForegroundColor Green

    Write-Host "`n=====================================================" -ForegroundColor Green
    Write-Host " ALL SERIAL QUALITY CHECKS PASSED!" -ForegroundColor Green
    Write-Host "=====================================================" -ForegroundColor Green

    exit 0
} catch {
    Write-Host "`n[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
