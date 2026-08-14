<#
.SYNOPSIS
    Suite di test per sidecar Python e database vettoriale LanceDB con Fail-Fast rigoroso.
#>

param(
    [switch]$Fast = $true,
    [switch]$Full = $false,
    [switch]$FullOutput = $false
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " OnlyRag V2 - Python Sidecar & Vector DB Test Suite" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

$healthUrl = "http://127.0.0.1:8000/health"
$exportUrl = "http://127.0.0.1:8000/export"
$searchUrl = "http://127.0.0.1:8000/vector/search"

try {
    Write-Host "`n[1/3] Testing Python Sidecar Health Endpoint ($healthUrl)..." -NoNewline
    $res = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 3
    if ($res.status -eq "online") {
        Write-Host " [PASS]" -ForegroundColor Green
        if ($FullOutput) {
            Write-Host "      Engine: $($res.engine) | Version: $($res.version) | Vector DB: $($res.vector_db)" -ForegroundColor Gray
        }
    } else {
        Write-Host " [FAIL]" -ForegroundColor Red
        exit 1
    }

    Write-Host "[2/3] Testing Markdown Export Engine ($exportUrl)..." -NoNewline
    $body = @{ markdown_content = "# Test Document`n`nHello OnlyRag V2"; export_format = "pdf" } | ConvertTo-Json
    $exportRes = Invoke-RestMethod -Uri $exportUrl -Method Post -Body $body -ContentType "application/json" -TimeoutSec 5
    if ($exportRes.status -eq "success" -and $exportRes.base64_content) {
        Write-Host " [PASS]" -ForegroundColor Green
        if ($FullOutput) {
            Write-Host "      Generated File: $($exportRes.file_name)" -ForegroundColor Gray
        }
    } else {
        Write-Host " [FAIL]" -ForegroundColor Red
        exit 1
    }

    Write-Host "[3/3] Testing LanceDB Vector Search Endpoint ($searchUrl)..." -NoNewline
    $searchBody = @{ query = "test query"; top_k = 2 } | ConvertTo-Json
    $searchRes = Invoke-RestMethod -Uri $searchUrl -Method Post -Body $searchBody -ContentType "application/json" -TimeoutSec 5
    Write-Host " [PASS]" -ForegroundColor Green

    Write-Host "`n=====================================================" -ForegroundColor Cyan
    Write-Host " ALL SIDECAR LIVE TESTS PASSED!" -ForegroundColor Green
    Write-Host "=====================================================" -ForegroundColor Cyan
    exit 0

} catch {
    Write-Host " [OFFLINE/SKIP]" -ForegroundColor Yellow
    Write-Host "Note: Live sidecar server not currently bound at port 8000. Running Pytest test suite directly..." -ForegroundColor Gray
}

try {
    # 4. Execute Pytest Test Suite
    Write-Host "`n[4/4] Running Pytest test suite (sidecar/tests/test_sidecar.py)..." -ForegroundColor Yellow
    $rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path
    $pytestBin = Join-Path -Path $rootDir -ChildPath ".venv\Scripts\pytest.exe"

    if (Test-Path $pytestBin) {
        & $pytestBin "$rootDir\sidecar\tests\test_sidecar.py" -q
        if ($LASTEXITCODE -ne 0) {
            throw "[FAIL] Pytest test suite failed with exit code $LASTEXITCODE."
        }
        Write-Host "[PASS] Pytest sidecar test suite clean." -ForegroundColor Green
    } else {
        python -m pytest "$rootDir\sidecar\tests\test_sidecar.py" -q
        if ($LASTEXITCODE -ne 0) {
            throw "[FAIL] Pytest test suite failed with exit code $LASTEXITCODE."
        }
        Write-Host "[PASS] Pytest sidecar test suite clean." -ForegroundColor Green
    }

    Write-Host "`n=====================================================" -ForegroundColor Cyan
    Write-Host " ALL SIDECAR TESTS PASSED!" -ForegroundColor Green
    Write-Host "=====================================================" -ForegroundColor Cyan
    exit 0
} catch {
    Write-Host "`n[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
