<#
.SYNOPSIS
    Rimuove gli artefatti generati e le cache del repository OnlyRag V2.
.DESCRIPTION
    Opera esclusivamente dentro la root del repository. Non rimuove dipendenze,
    dati utente, log applicativi o file tracciati da Git. Usare clean_workspace.ps1
    per la pulizia esplicita di log e dati locali.
#>

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = "Medium")]
param()

$ErrorActionPreference = "Stop"
if (Test-Path Variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $true
}

$rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path
$rootPrefix = "$rootDir\"

# Sono inclusi solo output e cache rigenerabili. node_modules/.vite e
# node_modules/.cache sono cache interne, non la dipendenza installata.
$targets = @(
    "build",
    "dist",
    "dist-electron",
    "out",
    "release",
    "sidecar_dist",
    "scripts\build",
    "scripts\dist",
    ".vite",
    "node_modules\.vite",
    "node_modules\.cache",
    ".pytest_cache",
    "sidecar\.pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    ".cache",
    "coverage",
    ".nyc_output",
    "test-results",
    "htmlcov"
)

function Get-RepositoryRelativePath {
    param([Parameter(Mandatory)][string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Percorso fuori dalla root del repository: $fullPath"
    }
    return $fullPath.Substring($rootPrefix.Length).Replace("\", "/")
}

$trackedPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($trackedPath in (git -C $rootDir ls-files)) {
    [void]$trackedPaths.Add(([string]$trackedPath).Replace("\", "/"))
}

function Test-TrackedPath {
    param([Parameter(Mandatory)][string]$RelativePath)

    return $trackedPaths.Contains($RelativePath)
}

$removedCount = 0

foreach ($relativeTarget in $targets) {
    $target = Join-Path -Path $rootDir -ChildPath $relativeTarget
    if (-not (Test-Path -LiteralPath $target)) {
        continue
    }

    $resolvedTarget = (Resolve-Path -LiteralPath $target).Path
    if ($PSCmdlet.ShouldProcess($resolvedTarget, "Remove generated repository artifact")) {
        Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
        $removedCount++
        Write-Output "Removed: $relativeTarget"
    }
}

# Rimuove file temporanei solo se non sono tracciati. Le directory di dipendenze,
# virtualenv e metadati Git sono escluse dalla scansione ricorsiva.
$excludedTopLevelDirectories = @(
    ".git", "node_modules", ".venv", "venv", "env",
    ".onlyrag", "userdata_dev", "data", "export", "lancedb_store", "logs"
)
$temporaryNamePattern = "^(.*\.(tmp|temp|bak|orig|rej|pyc|pyo|pyd|tsbuildinfo|log(\..*)?))$|^(Thumbs\.db|ehthumbs\.db|desktop\.ini|\.DS_Store|\.coverage(\..*)?)$"

$temporaryFiles = Get-ChildItem -LiteralPath $rootDir -Recurse -Force -File -ErrorAction Stop |
    Where-Object {
        $relativePath = Get-RepositoryRelativePath -Path $_.FullName
        $parts = $relativePath -split "/"
        $parts[0] -notin $excludedTopLevelDirectories -and
        $_.Name -match $temporaryNamePattern -and
        -not (Test-TrackedPath -RelativePath $relativePath)
    }

foreach ($file in $temporaryFiles) {
    if ($PSCmdlet.ShouldProcess($file.FullName, "Remove untracked temporary file")) {
        Remove-Item -LiteralPath $file.FullName -Force
        $removedCount++
        Write-Output "Removed: $(Get-RepositoryRelativePath -Path $file.FullName)"
    }
}

$generatedDirectories = Get-ChildItem -LiteralPath $rootDir -Recurse -Force -Directory -ErrorAction Stop |
    Where-Object {
        $relativePath = Get-RepositoryRelativePath -Path $_.FullName
        $parts = $relativePath -split "/"
        $parts[0] -notin $excludedTopLevelDirectories -and
        $_.Name -in @("__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache") -or
        ($parts[0] -notin $excludedTopLevelDirectories -and $_.Name -like "*.egg-info")
    } |
    Sort-Object FullName -Descending

foreach ($directory in $generatedDirectories) {
    if ($PSCmdlet.ShouldProcess($directory.FullName, "Remove generated cache directory")) {
        Remove-Item -LiteralPath $directory.FullName -Recurse -Force
        $removedCount++
        Write-Output "Removed: $(Get-RepositoryRelativePath -Path $directory.FullName)"
    }
}

Write-Output "Repository cleanup complete. Removed $removedCount item(s)."
