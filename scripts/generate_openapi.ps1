$ErrorActionPreference = "Stop"
$rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path
$pythonBin = Join-Path $rootDir ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonBin)) {
    throw "Required Python virtualenv not found: $pythonBin"
}

& $pythonBin (Join-Path $PSScriptRoot "generate_openapi.py")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
