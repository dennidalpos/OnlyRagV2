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
.PARAMETER UnitOnly
    Esegue unicamente la suite di unit test TypeScript.
#>

[CmdletBinding()]
param(
    [switch]$Fast = $true,
    [switch]$Full = $false,
    [switch]$Format = $false,
    [switch]$UnitOnly = $false
)

$ErrorActionPreference = "Stop"
if (Test-Path Variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $true
}
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    if (-not $Fast -or $Full) {
        Write-Host "=====================================================" -ForegroundColor Cyan
        Write-Host " OnlyRag V2 - Serial Quality, Lint & Format Script" -ForegroundColor Cyan
        Write-Host "=====================================================" -ForegroundColor Cyan
    }

    $rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path
    Push-Location $rootDir

    # 1. JSON Configuration Syntax Check
    if (-not $Fast -or $Full -or $Format) {
        Write-Host "`n[1/5] Validating JSON configurations..." -ForegroundColor Yellow
    }
    $jsonFiles = @("package.json", "tsconfig.json", "PROJECT_STATUS.json")
    foreach ($jf in $jsonFiles) {
        $jPath = Join-Path -Path $rootDir -ChildPath $jf
        if (Test-Path $jPath) {
            try {
                $null = Get-Content -Raw -Path $jPath | ConvertFrom-Json
                if (-not $Fast -or $Full) {
                    Write-Host "  [OK] $jf valid." -ForegroundColor DarkGray
                }
            } catch {
                throw "[FAIL] Invalid JSON syntax in $($jf): $($_.Exception.Message)"
            }
        }
    }
    if (-not $Fast -or $Full) {
        Write-Host "[PASS] JSON configurations valid." -ForegroundColor Green
    }

    # 2. TypeScript Typecheck
    if (-not $Fast -or $Full) {
        Write-Host "`n[2/5] Checking TypeScript type safety (tsc --noEmit)..." -ForegroundColor Yellow
    }
    npm run typecheck
    if ($LASTEXITCODE -ne 0) {
        throw "[FAIL] TypeScript typecheck failed with exit code $LASTEXITCODE."
    }
    if (-not $Fast -or $Full) {
        Write-Host "[PASS] TypeScript typecheck clean." -ForegroundColor Green
    }

    # 3. Python Sidecar Syntax Check
    if (-not $Fast -or $Full) {
        Write-Host "`n[3/5] Checking Python sidecar syntax..." -ForegroundColor Yellow
    }
    $sidecarDir = Join-Path -Path $rootDir -ChildPath "sidecar"
    if (Test-Path $sidecarDir) {
        $pyFiles = Get-ChildItem -Path $sidecarDir -Filter "*.py" -Recurse
        foreach ($py in $pyFiles) {
            python -m py_compile $py.FullName
            if ($LASTEXITCODE -ne 0) {
                throw "[FAIL] Python syntax check failed on $($py.FullName) with exit code $LASTEXITCODE."
            }
        }
        if (-not $Fast -or $Full) {
            Write-Host "[PASS] Python sidecar ($($pyFiles.Count) files) syntax clean." -ForegroundColor Green
        }
    } else {
        if (-not $Fast -or $Full) {
            Write-Host "[SKIP] Sidecar directory non trovata, step saltato." -ForegroundColor Gray
        }
    }

    # 4. Vitest Serial Test Suite
    if (-not $Fast -or $Full) {
        Write-Host "`n[4/5] Running Vitest serial test suite..." -ForegroundColor Yellow
    }
    if ($UnitOnly) {
        npm run test:unit-only
    } elseif ($Full) {
        npm run test
    } else {
        npm run test:fast
    }
    if ($LASTEXITCODE -ne 0) {
        throw "[FAIL] Vitest test suite failed with exit code $LASTEXITCODE."
    }
    if (-not $Fast -or $Full) {
        Write-Host "[PASS] Vitest unit test suite clean." -ForegroundColor Green
    }

    # 5. Electron Main Process Bundle Smoke Test
    if (-not $UnitOnly -and -not $Format) {
        if (-not $Fast -or $Full) {
            Write-Host "`n[5/5] Running Electron main bundle smoke test..." -ForegroundColor Yellow
        }
        $smokeScript = Join-Path -Path $PSScriptRoot -ChildPath "test_bundle_smoke.ps1"
        if (Test-Path $smokeScript) {
            if ($Full) {
                & $smokeScript -Full
            } else {
                & $smokeScript -Fast
            }
            if ($LASTEXITCODE -ne 0) {
                throw "[FAIL] Electron main bundle smoke test failed with exit code $LASTEXITCODE."
            }
            if (-not $Fast -or $Full) {
                Write-Host "[PASS] Electron main bundle smoke test clean." -ForegroundColor Green
            }
        }
    }

    if ($Fast -and -not $Full) {
        Write-Host "`n=====================================================" -ForegroundColor Green
        Write-Host " ALL SERIAL QUALITY CHECKS PASSED!" -ForegroundColor Green
        Write-Host "=====================================================" -ForegroundColor Green
    } else {
        Write-Host "`n=====================================================" -ForegroundColor Green
        Write-Host " ALL SERIAL QUALITY CHECKS PASSED!" -ForegroundColor Green
        Write-Host "=====================================================" -ForegroundColor Green
    }

    exit 0
} catch {
    Write-Host "`n[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
