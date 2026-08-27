$ErrorActionPreference = "Stop"
$rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path
$isWindowsHost = $IsWindows -or $env:OS -eq 'Windows_NT'
$venvBinDir = if ($isWindowsHost) { "Scripts" } else { "bin" }
$pythonExeName = if ($isWindowsHost) { "python.exe" } else { "python" }
$pythonBin = Join-Path (Join-Path $rootDir ".venv") (Join-Path $venvBinDir $pythonExeName)
if (-not (Test-Path -LiteralPath $pythonBin)) {
    throw "Required Python virtualenv not found: $pythonBin"
}

& $pythonBin (Join-Path $PSScriptRoot "generate_openapi.py")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
