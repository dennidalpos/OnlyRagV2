<#
.SYNOPSIS
    Suite di test per sidecar Python e database vettoriale LanceDB con Fail-Fast rigoroso.
.DESCRIPTION
    Verifica lo stato di salute del sidecar FastAPI, l'export Markdown/PDF, la ricerca vettoriale LanceDB
    e la suite di unit test Pytest.
.PARAMETER Fast
    Esegue la suite in modalità sintetica veloce per AI Agent.
.PARAMETER Full
    Esegue la suite con output esteso e verboso per debugging.
.PARAMETER FullOutput
    Mostra i dati di risposta dettagliati dagli endpoint HTTP.
#>

[CmdletBinding()]
param(
    [switch]$Fast = $true,
    [switch]$Full = $false,
    [switch]$FullOutput = $false
)

$ErrorActionPreference = "Stop"
if (Test-Path Variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $true
}
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $Fast -or $Full) {
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host " OnlyRag V2 - Python Sidecar & Vector DB Test Suite" -ForegroundColor Cyan
    Write-Host "=====================================================" -ForegroundColor Cyan
}

$healthUrl = "http://127.0.0.1:8000/health"
$exportUrl = "http://127.0.0.1:8000/export"
$searchUrl = "http://127.0.0.1:8000/vector/search"

$liveServerAvailable = $false

try {
    $res = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2 -ErrorAction Stop
    $liveServerAvailable = $true
} catch {
    if (-not $Fast -or $Full) {
        Write-Host "`n[INFO] Live sidecar server not bound at port 8000 (offline). Running Pytest suite..." -ForegroundColor Gray
    }
}

if ($liveServerAvailable) {
    try {
        if (-not $Fast -or $Full) {
            Write-Host "`n[1/3] Testing Python Sidecar Health Endpoint ($healthUrl)..." -NoNewline
        }
        if ($res.status -eq "online") {
            if (-not $Fast -or $Full) { Write-Host " [PASS]" -ForegroundColor Green }
            if ($FullOutput) {
                Write-Host "      Engine: $($res.engine) | Version: $($res.version) | Vector DB: $($res.vector_db)" -ForegroundColor Gray
            }
        } else {
            throw "[FAIL] Sidecar health endpoint returned non-online status: $($res.status)"
        }

        if (-not $Fast -or $Full) {
            Write-Host "[2/3] Testing Markdown Export Engine ($exportUrl)..." -NoNewline
        }
        $body = @{ markdown_content = "# Test Document`n`nHello OnlyRag V2"; export_format = "pdf" } | ConvertTo-Json
        $exportRes = Invoke-RestMethod -Uri $exportUrl -Method Post -Body $body -ContentType "application/json" -TimeoutSec 5 -ErrorAction Stop
        if ($exportRes.status -eq "success" -and $exportRes.base64_content) {
            if (-not $Fast -or $Full) { Write-Host " [PASS]" -ForegroundColor Green }
            if ($FullOutput) {
                Write-Host "      Generated File: $($exportRes.file_name)" -ForegroundColor Gray
            }
        } else {
            throw "[FAIL] Sidecar export engine failed to return valid response."
        }

        if (-not $Fast -or $Full) {
            Write-Host "[3/3] Testing LanceDB Vector Search Endpoint ($searchUrl)..." -NoNewline
        }
        $searchBody = @{ query = "test query"; top_k = 2 } | ConvertTo-Json
        $searchRes = Invoke-RestMethod -Uri $searchUrl -Method Post -Body $searchBody -ContentType "application/json" -TimeoutSec 5 -ErrorAction Stop
        if (-not $Fast -or $Full) { Write-Host " [PASS]" -ForegroundColor Green }

        Write-Host "`n=====================================================" -ForegroundColor Cyan
        Write-Host " ALL SIDECAR LIVE TESTS PASSED!" -ForegroundColor Green
        Write-Host "=====================================================" -ForegroundColor Cyan
        exit 0
    } catch {
        Write-Host "`n[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

try {
    # Execute Pytest Test Suite
    if (-not $Fast -or $Full) {
        Write-Host "`n[4/4] Running Pytest test suite (sidecar/tests/)..." -ForegroundColor Yellow
    }
    $rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path
    $pytestBin = Join-Path -Path $rootDir -ChildPath ".venv\Scripts\pytest.exe"

    if (Test-Path $pytestBin) {
        & $pytestBin "$rootDir\sidecar\tests" -q
        if ($LASTEXITCODE -ne 0) {
            throw "[FAIL] Pytest test suite failed with exit code $LASTEXITCODE."
        }
        if (-not $Fast -or $Full) { Write-Host "[PASS] Pytest sidecar test suite clean." -ForegroundColor Green }
    } else {
        $appDataPy = "$env:APPDATA\onlyrag-v2\python_venv\Scripts\python.exe"
        $pyCmd = if (Test-Path $appDataPy) { $appDataPy } else { "python" }

        & $pyCmd -m pytest "$rootDir\sidecar\tests" -q 2>$null
        if ($LASTEXITCODE -ne 0) {
            & $pyCmd -m pytest "$rootDir\sidecar\tests"
            if ($LASTEXITCODE -ne 0) {
                throw "[FAIL] Sidecar test suite failed with exit code $LASTEXITCODE."
            }
        }
        if (-not $Fast -or $Full) { Write-Host "[PASS] Sidecar test suite clean." -ForegroundColor Green }
    }

    Write-Host "`n=====================================================" -ForegroundColor Cyan
    Write-Host " ALL SIDECAR TESTS PASSED!" -ForegroundColor Green
    Write-Host "=====================================================" -ForegroundColor Cyan
    exit 0
} catch {
    Write-Host "`n[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
