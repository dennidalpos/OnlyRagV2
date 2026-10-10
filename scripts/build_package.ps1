<#
.SYNOPSIS
    Build a fresh CPU-only NSIS candidate with notices and matching source.
#>
[CmdletBinding()]
param(
    [switch]$SkipSidecar = $false,
    [switch]$Fast = $false,
    [switch]$RequireSignature = $false
)

$ErrorActionPreference = 'Stop'
if (Test-Path Variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $true
}
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$pushed = $false

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

try {
    if ($SkipSidecar) { throw 'CPU release requires a fresh Sidecar build; -SkipSidecar is no longer supported.' }
    $rootDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
    Push-Location $rootDir
    $pushed = $true
    $releaseParent = [IO.Path]::GetFullPath((Join-Path $rootDir 'release'))
    $releaseName = 'cpu-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $releaseRoot = [IO.Path]::GetFullPath((Join-Path $releaseParent $releaseName))
    if ([IO.Path]::GetDirectoryName($releaseRoot) -cne $releaseParent -or (Test-Path -LiteralPath $releaseRoot)) {
        throw 'Release output must be a new direct child of release/.'
    }
    New-Item -ItemType Directory -Path $releaseRoot | Out-Null
    Write-Host "CPU candidate output: $releaseRoot"

    & (Join-Path $PSScriptRoot 'generate_assets.ps1') -Check
    if ($LASTEXITCODE -ne 0) { throw 'Asset validation failed.' }
    Invoke-Checked -Command 'npm' -Arguments @('run', 'typecheck')
    $cpuEnvironment = Join-Path $rootDir 'build/release-cpu/venv'
    $cpuPython = Join-Path $cpuEnvironment 'Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $cpuPython)) {
        $developmentPython = Join-Path $rootDir '.venv/Scripts/python.exe'
        if (-not (Test-Path -LiteralPath $developmentPython)) { throw 'Python 3.13 development interpreter is required to create the isolated release environment.' }
        Invoke-Checked -Command $developmentPython -Arguments @('-m', 'venv', $cpuEnvironment)
    }
    $version = & $cpuPython --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^Python 3\.13\.') { throw 'Release requires Python 3.13.' }
    Invoke-Checked -Command $cpuPython -Arguments @('-m', 'pip', 'install', '--disable-pip-version-check', '-r', (Join-Path $rootDir 'sidecar/requirements-release.txt'))
    Invoke-Checked -Command $cpuPython -Arguments @('-m', 'pip', 'check')
    $artifactsScript = Join-Path $PSScriptRoot 'release_artifacts.py'
    Invoke-Checked -Command $cpuPython -Arguments @($artifactsScript, 'environment')
    Invoke-Checked -Command $cpuPython -Arguments @('-m', 'PyInstaller', '--distpath', (Join-Path $releaseRoot 'sidecar-dist'), '--workpath', (Join-Path $releaseRoot 'pyinstaller-work'), (Join-Path $rootDir 'sidecar.spec'))
    $sidecarExe = Join-Path $releaseRoot 'sidecar-dist/sidecar/sidecar.exe'
    if (-not (Test-Path -LiteralPath $sidecarExe -PathType Leaf)) { throw 'CPU Sidecar executable is missing.' }

    & (Join-Path $PSScriptRoot 'test_bundle_smoke.ps1') -Fast
    if ($LASTEXITCODE -ne 0) { throw 'Electron bundle smoke failed.' }
    Invoke-Checked -Command $cpuPython -Arguments @($artifactsScript, 'prepare', '--release-root', $releaseRoot)
    Invoke-Checked -Command 'npx' -Arguments @('--no-install', 'electron-builder', '--config', (Join-Path $releaseRoot 'electron-builder.json'), '--win', 'nsis', '--x64', '--publish', 'never')
    Invoke-Checked -Command $cpuPython -Arguments @($artifactsScript, 'finalize', '--release-root', $releaseRoot)

    $installer = @(Get-ChildItem -LiteralPath $releaseRoot -Filter '*Setup*.exe' -File)
    if ($installer.Count -ne 1) { throw 'Expected exactly one NSIS installer.' }
    $signature = $null
    try { $signature = Get-AuthenticodeSignature -FilePath $installer[0].FullName -ErrorAction Stop }
    catch { if ($RequireSignature) { throw }; Write-Host 'Authenticode status could not be determined.' }
    if ($RequireSignature -and ($null -eq $signature -or $signature.Status -ne 'Valid')) { throw 'A valid installer signature was required.' }
    $signatureStatus = if ($null -eq $signature) { 'Unverifiable' } else { $signature.Status }
    $hash = (Get-FileHash -LiteralPath $installer[0].FullName -Algorithm SHA256).Hash
    Write-Host "[PASS] CPU candidate built: $($installer[0].Name), $($installer[0].Length) bytes, signature $signatureStatus, SHA256 $hash"
    Write-Host 'License/source completeness and public delivery remain qualification gates; nothing was published.'
    exit 0
} catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($pushed) { Pop-Location }
}
