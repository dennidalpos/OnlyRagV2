<#
.SYNOPSIS
    Esegue la suite pytest ordinaria del Sidecar Python in modo deterministico.
.DESCRIPTION
    Non interroga servizi in esecuzione (nessuna richiesta alla porta 8000 o ad altri endpoint):
    lancia sempre `python -m pytest -q` dalla radice del repository, usando `pytest.ini`
    (testpaths = sidecar/tests), e propaga il codice di uscita di pytest.
    Un interprete o un pytest mancante fa fallire il comando con un messaggio esplicito.
.PARAMETER PythonExe
    Interprete Python con pytest installato. Predefinito: .venv\Scripts\python.exe del checkout.
#>

[CmdletBinding()]
param(
    [string]$PythonExe = ''
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath '..')).Path
if (-not $PythonExe) {
    $PythonExe = Join-Path $rootDir '.venv\Scripts\python.exe'
}

if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
    Write-Host "[FAIL] Interprete Python non trovato: $PythonExe. Eseguire npm run setup:dev." -ForegroundColor Red
    exit 2
}

# Windows PowerShell 5.1 turns redirected native stderr into error records: with Stop they would
# replace the interpreter's exit code. Native results are judged only by $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
& $PythonExe -m pytest --version *> $null
$versionExit = $LASTEXITCODE
if ($versionExit -ne 0) {
    Write-Host "[FAIL] pytest non disponibile per $PythonExe (exit $versionExit). Eseguire npm run setup:dev." -ForegroundColor Red
    exit 2
}

Push-Location -LiteralPath $rootDir
try {
    & $PythonExe -m pytest -q
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($code -ne 0) {
    Write-Host "[FAIL] Suite pytest del Sidecar fallita (exit $code)." -ForegroundColor Red
}
exit $code
