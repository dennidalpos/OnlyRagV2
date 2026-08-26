<#
.SYNOPSIS
    Prepara l'ambiente di sviluppo usando la root del repository dello script.
.DESCRIPTION
    Verifica Node.js 22+ e Python 3.12+, installa le dipendenze npm dal lockfile e
    crea/aggiorna il virtualenv Python locale senza dipendere dalla directory corrente.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8

function Stop-WithMessage([string]$message) {
    throw "[SETUP ERROR] $message"
}

try {
    $rootDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    Push-Location $rootDir

    $nodeVersion = (& node --version).Trim().TrimStart('v')
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'Node.js non trovato nel PATH. Installare Node.js 22 LTS o superiore.' }
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -lt 22 -or $nodeMajor -ge 26) { Stop-WithMessage "Node.js $nodeVersion rilevato: richiesto >=22 e <26." }

    $pythonLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pythonLauncher) {
        $pythonCommand = 'py'
        $pythonArgs = @('-3.12')
        & $pythonCommand @pythonArgs --version | Out-Null
    } else {
        $pythonCommand = 'python'
        $pythonArgs = @()
        & $pythonCommand --version | Out-Null
    }
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'Python 3.12 non trovato. Installare Python 3.12 e ripetere.' }
    $pythonVersion = (& $pythonCommand @pythonArgs --version 2>&1).ToString()
    if ($pythonVersion -notmatch 'Python 3\.12\.') { Stop-WithMessage "Rilevato ${pythonVersion}: richiesto Python 3.12." }

    npm ci
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Installazione delle dipendenze npm fallita con exit code $LASTEXITCODE." }
    $venvDir = Join-Path $rootDir '.venv'
    $venvPython = if ($env:OS -eq 'Windows_NT') { Join-Path (Join-Path $venvDir 'Scripts') 'python.exe' } else { Join-Path (Join-Path $venvDir 'bin') 'python' }
    $venvIsValid = $false
    $venvConfig = Join-Path $venvDir 'pyvenv.cfg'
    if ((Test-Path -LiteralPath $venvPython) -and (Test-Path -LiteralPath $venvConfig)) {
        $venvVersion = (Get-Content -LiteralPath $venvConfig | Where-Object { $_ -match '^version\s*=' } | Select-Object -First 1)
        $venvIsValid = $venvVersion -match 'version\s*=\s*3\.12\.'
    }
        if (-not $venvIsValid) {
            if (Test-Path -LiteralPath $venvDir) {
                Remove-Item -LiteralPath $venvDir -Recurse -Force
            }
            & $pythonCommand @pythonArgs -m venv $venvDir
        }
    if (-not (Test-Path -LiteralPath $venvPython)) { Stop-WithMessage "Virtualenv non creato in $venvDir." }

    & $venvPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'Aggiornamento di pip fallito.' }
    & $venvPython -m pip install -r (Join-Path $rootDir 'sidecar/requirements-dev.txt')
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'Installazione delle dipendenze Python fallita.' }
    Write-Host "[PASS] Ambiente pronto in $rootDir" -ForegroundColor Green
    exit 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
