<#
.SYNOPSIS
    Rimuove gli artefatti temporanei e di build del repository OnlyRag V2.
.DESCRIPTION
    Opera esclusivamente dentro la root del repository. Non arresta processi e non
    rimuove dipendenze locali, dati utente o file tracciati da Git.
#>

[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = "Stop"
if (Test-Path Variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $true
}

$rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path
$targets = @(
    "build",
    "dist",
    "dist-electron",
    "out",
    "release",
    "sidecar_dist",
    "scripts\build",
    "scripts\dist",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    ".cache",
    "coverage",
    ".nyc_output",
    "test-results",
    "htmlcov",
    "logs",
    ".onlyrag",
    "userdata_dev",
    "lancedb_store",
    "export",
    "data"
)

foreach ($relativeTarget in $targets) {
    $target = Join-Path -Path $rootDir -ChildPath $relativeTarget
    if (Test-Path -LiteralPath $target) {
        if ($PSCmdlet.ShouldProcess($target, "Remove repository artifact")) {
            Remove-Item -LiteralPath $target -Recurse -Force
            Write-Output "Removed: $relativeTarget"
        }
    }
}

$excludedDirectories = @(".git", "node_modules", ".venv", "venv", "env")
$temporaryFiles = Get-ChildItem -LiteralPath $rootDir -Recurse -Force -File -ErrorAction Stop |
    Where-Object {
        $relativePath = $_.FullName.Substring($rootDir.Length).TrimStart("\", "/")
        $parts = $relativePath -split "[\\/]"
        $parts[0] -notin $excludedDirectories -and
        $_.Name -match "^(.*\.(tmp|temp|bak|orig|rej|pyc|pyo|pyd|tsbuildinfo|log(\..*)?))$|^(Thumbs\.db|ehthumbs\.db|desktop\.ini|\.DS_Store)$"
    }

foreach ($file in $temporaryFiles) {
    if ($PSCmdlet.ShouldProcess($file.FullName, "Remove temporary file")) {
        Remove-Item -LiteralPath $file.FullName -Force
        Write-Output "Removed: $($file.FullName.Substring($rootDir.Length + 1))"
    }
}
