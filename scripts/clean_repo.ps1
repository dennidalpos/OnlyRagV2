<#
.SYNOPSIS
    Remove only explicitly reviewed repository output paths.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param([string[]]$DisposablePaths)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cleanup_policy.ps1')
try {
    $repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
    $selection = @(Assert-CleanupSelection $DisposablePaths $repositoryRoot 'Repo')
    $removedCount = 0
    foreach ($target in $selection) {
        $null = Assert-CleanupSelection @($target) $repositoryRoot 'Repo'
        if ($PSCmdlet.ShouldProcess($target, 'Remove explicitly reviewed repository output')) {
            Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
            $removedCount++
        }
    }
    Write-Output "Repository cleanup complete. Removed $removedCount explicit item(s)."
    exit 0
} catch {
    Write-Output "Cleanup refused: $($_.Exception.Message)"
    exit 1
}
