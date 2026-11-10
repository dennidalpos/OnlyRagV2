[CmdletBinding()]
param([string[]]$ToolPaths = @(), [string]$JavaHome, [switch]$PrepareDependencies)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$previousPath = $env:Path
$previousJava = $env:JAVA_HOME
$previousPrepare = $env:ONLYRAG_NATIVE_PREPARE
try {
    foreach ($directory in $ToolPaths) {
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw "Tool directory not found: $directory" }
    }
    $venv = Join-Path $repo '.venv\Scripts'
    $paths = @($ToolPaths)
    if (Test-Path -LiteralPath (Join-Path $venv 'python.exe')) { $paths += $venv }
    $env:Path = (@($paths) + $previousPath) -join ';'
    if ($JavaHome) {
        if (-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) { throw 'JavaHome must name an installed JDK' }
        $env:JAVA_HOME = $JavaHome
    }
    $env:ONLYRAG_NATIVE_PREPARE = if ($PrepareDependencies) { '1' } else { '0' }
    Push-Location -LiteralPath $repo
    try {
        & node node_modules/vitest/vitest.mjs run --config vitest.native.config.mts
        if ($LASTEXITCODE -ne 0) { throw "Native qualification failed: $LASTEXITCODE" }
    } finally { Pop-Location }
} finally {
    $env:Path = $previousPath
    $env:JAVA_HOME = $previousJava
    $env:ONLYRAG_NATIVE_PREPARE = $previousPrepare
}
