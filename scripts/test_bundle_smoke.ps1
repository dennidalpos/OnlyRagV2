<#
.SYNOPSIS
    Script di Smoke Test per il bundle Electron Main Process di OnlyRag V2.
.DESCRIPTION
    Compila il bundle Electron con Vite ed esegue il main process in modalità smoke test
    (--smoke-test / ONLYRAG_SMOKE_TEST=1). Verifica che tutti i moduli runtime e i canali IPC
    si carichino senza errori di import dinamico (es. require dinamici non risolti) prima del packaging.
.PARAMETER Fast
    Modalità sintetica per AI Agent (default: true).
.PARAMETER Full
    Output dettagliato di diagnostica.
.PARAMETER SkipBuild
    Salta la fase preliminare di build Vite ed esegue lo smoke test sul dist-electron esistente.
.PARAMETER TimeoutSeconds
    Timeout massimo di attesa per l'avvio e la chiusura del processo (default: 15 secondi).
#>

[CmdletBinding()]
param(
    [switch]$Fast = $true,
    [switch]$Full = $false,
    [switch]$SkipBuild = $false,
    [int]$TimeoutSeconds = 15
)

$ErrorActionPreference = "Stop"
if (Test-Path Variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $true
}
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    $rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path

    if (-not $Fast -or $Full) {
        Write-Host "=====================================================" -ForegroundColor Cyan
        Write-Host " OnlyRag V2 - Electron Main Process Bundle Smoke Test" -ForegroundColor Cyan
        Write-Host "=====================================================" -ForegroundColor Cyan
    }

    # 1. Build preliminare del bundle Electron se richiesto o se mancante
    $mainJs = Join-Path $rootDir "dist-electron\main.js"
    if (-not $SkipBuild -or (-not (Test-Path $mainJs))) {
        if (-not $Fast -or $Full) {
            Write-Host "`n[1/2] Compilazione bundle Electron (vite build)..." -ForegroundColor Yellow
        }
        npx vite build
        if ($LASTEXITCODE -ne 0) {
            throw "[FAIL] Compilazione Vite fallita con exit code $LASTEXITCODE."
        }
        if (-not $Fast -or $Full) {
            Write-Host "  [OK] Bundle generato con successo in dist-electron/." -ForegroundColor DarkGray
        }
    } else {
        if (-not $Fast -or $Full) {
            Write-Host "`n[1/2] Skip compilazione Vite (-SkipBuild attivo)." -ForegroundColor DarkGray
        }
    }

    if (-not (Test-Path $mainJs)) {
        throw "[FAIL] File dist-electron/main.js non trovato."
    }

    # 2. Localizzazione dell'eseguibile Electron
    $electronExe = Join-Path $rootDir "node_modules\electron\dist\electron.exe"
    if (-not (Test-Path $electronExe)) {
        throw "[FAIL] Eseguibile Electron non trovato in: $electronExe"
    }

    if (-not $Fast -or $Full) {
        Write-Host "`n[2/2] Esecuzione Smoke Test del Main Process..." -ForegroundColor Yellow
    }

    # 3. Lancio di Electron in modalità Smoke Test
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $electronExe
    $psi.Arguments = "`"$mainJs`" --smoke-test"
    $psi.WorkingDirectory = $rootDir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables["ONLYRAG_SMOKE_TEST"] = "1"
    $psi.EnvironmentVariables["ELECTRON_ENABLE_LOGGING"] = "1"

    $proc = [System.Diagnostics.Process]::Start($psi)
    $exited = $proc.WaitForExit($TimeoutSeconds * 1000)

    if (-not $exited) {
        try {
            $proc.Kill()
        } catch {}
        throw "[FAIL] Timeout superato ($TimeoutSeconds s): il main process non ha completato l'inizializzazione entro il tempo limite."
    }

    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()

    if ($proc.ExitCode -ne 0) {
        throw "[FAIL] Electron main process terminato con exit code $($proc.ExitCode).`nStdout:`n$stdout`nStderr:`n$stderr"
    }

    # 4. Verifica della presenza del marker di conferma in app.log
    $appData = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::ApplicationData)
    $appLog = Join-Path $appData "onlyrag-v2\logs\app.log"
    $verifiedInLog = $false

    if (Test-Path $appLog) {
        $recentLines = Get-Content -Path $appLog -Tail 30
        foreach ($line in $recentLines) {
            if ($line -match "\[SMOKE_TEST_PASS\]") {
                $verifiedInLog = $true
                break
            }
        }
    }

    if (-not $verifiedInLog -and -not ($stdout -match "\[SMOKE_TEST_PASS\]")) {
        throw "[FAIL] Processo uscito con code 0 ma nessun marcatore [SMOKE_TEST_PASS] rilevato nei log o in stdout."
    }

    if ($Fast -and -not $Full) {
        Write-Host "[PASS] Electron main bundle smoke test verified successfully." -ForegroundColor Green
    } else {
        Write-Host "`n=====================================================" -ForegroundColor Green
        Write-Host " ELECTRON MAIN BUNDLE SMOKE TEST PASSED!" -ForegroundColor Green
        Write-Host " Runtime modules, IPC handlers, and bundle lifecycle verified." -ForegroundColor White
        Write-Host "=====================================================" -ForegroundColor Green
    }

    exit 0
} catch {
    Write-Host "`n[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
