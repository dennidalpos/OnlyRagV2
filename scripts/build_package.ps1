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
$buildLock = $null

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

function Get-Sha256 {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

function Get-PlainDirectory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Expected a plain directory: $Path"
    }
    return $item.FullName
}

function Publish-Candidate {
    param([string]$RunRoot, [string]$ReleaseParent)
    $candidate = Join-Path $RunRoot 'candidate'
    $destination = Join-Path $ReleaseParent 'cpu'
    $previous = Join-Path $RunRoot 'previous'
    $hasPrevious = Test-Path -LiteralPath $destination
    if ($hasPrevious) {
        $existing = Get-Item -LiteralPath $destination -Force
        $manifestPath = Join-Path $destination 'release-manifest.json'
        if (-not $existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            throw "The release destination is already in use: $destination"
        }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ($manifest.kind -ne 'local-cpu-release-candidate') {
            throw "The release destination is already in use: $destination"
        }
        [IO.Directory]::Move($destination, $previous)
    }
    try {
        [IO.Directory]::Move($candidate, $destination)
    } catch {
        if ($hasPrevious -and -not (Test-Path -LiteralPath $destination)) {
            [IO.Directory]::Move($previous, $destination)
        }
        throw
    }
    if ($hasPrevious) { Write-Host "Previous CPU candidate retained at: $previous" }
}

try {
    if ($SkipSidecar) { throw 'CPU release requires a fresh Sidecar build; -SkipSidecar is no longer supported.' }
    $rootDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
    Push-Location $rootDir
    $pushed = $true
    $releaseParent = Get-PlainDirectory (Join-Path $rootDir 'release')
    $buildParent = Get-PlainDirectory (Join-Path $rootDir 'build')
    $cpuBuildRoot = Get-PlainDirectory (Join-Path $buildParent 'release-cpu')
    $buildLock = [IO.File]::Open((Join-Path $cpuBuildRoot 'package.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $runsRoot = Get-PlainDirectory (Join-Path $cpuBuildRoot 'runs')
    $releaseName = 'cpu-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $runRoot = Join-Path $runsRoot $releaseName
    New-Item -ItemType Directory -Path $runRoot | Out-Null
    $releaseRoot = Join-Path $runRoot 'candidate'
    New-Item -ItemType Directory -Path $releaseRoot | Out-Null
    Write-Host "CPU candidate staging: $releaseRoot"

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
    Invoke-Checked -Command $cpuPython -Arguments @('-m', 'PyInstaller', '--distpath', (Join-Path $releaseRoot 'sidecar-dist'), '--workpath', (Join-Path $runRoot 'pyinstaller-work'), (Join-Path $rootDir 'sidecar.spec'))
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
    $hash = Get-Sha256 -Path $installer[0].FullName
    [IO.File]::Move((Join-Path $releaseRoot 'electron-builder.json'), (Join-Path $runRoot 'electron-builder.json'))
    Publish-Candidate -RunRoot $runRoot -ReleaseParent $releaseParent
    $releaseRoot = Join-Path $releaseParent 'cpu'
    Write-Host "[PASS] CPU candidate built: $($installer[0].Name), $($installer[0].Length) bytes, signature $signatureStatus, SHA256 $hash"
    Write-Host 'License/source completeness and public delivery remain qualification gates; nothing was published.'

    Write-Host ""
    Write-Host "=== Riepilogo Artefatti di Build e Rilascio ===" -ForegroundColor Cyan
    Write-Host "Cartella rilascio: $releaseRoot"
    Write-Host "Installer Setup:   $(Join-Path $releaseRoot $installer[0].Name)"
    $sourceRecordFile = Join-Path $releaseRoot 'source-delivery.json'
    if (Test-Path -LiteralPath $sourceRecordFile) {
        $sourceRecord = Get-Content -LiteralPath $sourceRecordFile -Raw | ConvertFrom-Json
        Write-Host "Archivio sorgenti: $(Join-Path $releaseRoot $sourceRecord.path)"
    }
    Write-Host "Manifest rilascio: $(Join-Path $releaseRoot 'release-manifest.json')"
    Write-Host "Licenze e notice:  $(Join-Path $releaseRoot 'licenses')"
    Write-Host "Sidecar dist:      $(Join-Path $releaseRoot 'sidecar-dist')"
    Write-Host "==============================================="
    exit 0
} catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($null -ne $buildLock) { $buildLock.Dispose() }
    if ($pushed) { Pop-Location }
}
