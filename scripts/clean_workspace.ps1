<#
.SYNOPSIS
    Preflight explicit disposal paths; keep profiles out of Full cleanup.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [ValidateSet('Repo', 'Logs', 'TestResidues', 'InstallerCache', 'UserData', 'Full')]
    [string]$Mode = 'Repo',
    [string[]]$DisposablePaths,
    [switch]$CleanLogs,
    [switch]$Fast,
    [switch]$StopAppProcesses
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cleanup_policy.ps1')
try {
    if ($StopAppProcesses) { throw 'Process identity is unavailable; close the application deliberately. No process was stopped.' }
    if ($CleanLogs) { throw 'Use the separate Logs mode; combined cleanup cannot establish a single disposal scope.' }
    $repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
    if ($Mode -in @('Logs', 'UserData', 'InstallerCache') -and -not $DisposablePaths) {
        $DisposablePaths = @(Get-ExplicitWorkspaceCleanupRoots $repositoryRoot $Mode | Where-Object { Test-Path -LiteralPath $_ })
        if (-not $DisposablePaths) {
            Write-Output 'No existing paths in the explicit cleanup scope.'
            exit 0
        }
    }
    # Complete preflight before delegation or any removal.
    $selection = @(Assert-CleanupSelection $DisposablePaths $repositoryRoot $Mode)
    $removedCount = 0
    foreach ($target in $selection) {
        $null = Assert-CleanupSelection @($target) $repositoryRoot $Mode
        if ($Mode -eq 'Repo' -or ($Mode -eq 'Full' -and (Test-CleanupWithin $target $repositoryRoot))) {
            & (Join-Path $PSScriptRoot 'clean_repo.ps1') -DisposablePaths @($target) -WhatIf:$WhatIfPreference
            if ($LASTEXITCODE -ne 0) { throw "Repository cleanup failed (exit $LASTEXITCODE)." }
        } elseif ($PSCmdlet.ShouldProcess($target, "Remove explicitly reviewed $Mode path")) {
            Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
            $removedCount++
        }
    }
    Write-Output "Cleanup complete: $removedCount workspace item(s) removed; delegated repository paths reported separately."
    exit 0
} catch {
    Write-Output "Cleanup refused: $($_.Exception.Message)"
    exit 1
}
