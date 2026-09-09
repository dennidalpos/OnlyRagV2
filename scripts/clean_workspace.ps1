<#
.SYNOPSIS
    Pulisce in modo mirato repository e residui locali di OnlyRag V2.
.DESCRIPTION
    Delega la pulizia degli output del repository a clean_repo.ps1 e gestisce
    separatamente log, residui dei test live/unitari, cache dell'installer e dati utente.
    Tutti i target esterni al repository sono nomi esatti o pattern con prefisso OnlyRag.
.PARAMETER Mode
    Repo: output e cache rigenerabili del repository.
    Logs: directory di log note dell'applicazione.
    TestResidues: directory temporanee e workspace Desktop creati dai test OnlyRag.
    InstallerCache: cache dell'updater Electron in LocalAppData.
    UserData: dati applicativi locali; distruttivo per impostazioni e database utente.
    Full: tutte le modalità precedenti, inclusi i dati utente.
.PARAMETER CleanLogs
    Include i log oltre alla modalità selezionata.
.PARAMETER Fast
    Riduce l'output alla sintesi finale.
.PARAMETER StopAppProcesses
    Arresta esclusivamente il processo principale "OnlyRag V2" prima della pulizia.
    Non termina processi generici Electron, Python o sidecar.
#>

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = "Medium")]
param(
    [ValidateSet("Repo", "Logs", "TestResidues", "InstallerCache", "UserData", "Full")]
    [string]$Mode = "Repo",

    [switch]$CleanLogs,
    [switch]$Fast,
    [switch]$StopAppProcesses
)

$ErrorActionPreference = "Stop"
if (Test-Path Variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $true
}
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:removedCount = 0
$script:bytesFreed = [int64]0

function Get-NormalizedFullPath {
    param([Parameter(Mandatory)][string]$Path)

    return [System.IO.Path]::GetFullPath($Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
}

function Assert-SafeChildPath {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$AllowedRoot
    )

    $fullPath = Get-NormalizedFullPath -Path $Path
    $fullRoot = Get-NormalizedFullPath -Path $AllowedRoot
    $rootPrefix = "$fullRoot$([System.IO.Path]::DirectorySeparatorChar)"
    if ($fullPath -eq $fullRoot -or -not $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Target di pulizia non sicuro: '$fullPath' non e un figlio di '$fullRoot'."
    }
    return $fullPath
}

function Get-PathSize {
    param([Parameter(Mandatory)][string]$LiteralPath)

    if (Test-Path -LiteralPath $LiteralPath -PathType Leaf) {
        return [int64](Get-Item -LiteralPath $LiteralPath -Force).Length
    }
    $sum = Get-ChildItem -LiteralPath $LiteralPath -Recurse -Force -File -ErrorAction Stop |
        Measure-Object -Property Length -Sum
    if ($null -eq $sum.Sum) { return [int64]0 }
    return [int64]$sum.Sum
}

function Remove-OwnedPath {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$AllowedRoot,
        [Parameter(Mandatory)][string]$Label
    )

    $safePath = Assert-SafeChildPath -Path $Path -AllowedRoot $AllowedRoot
    if (-not (Test-Path -LiteralPath $safePath)) {
        return
    }

    $size = Get-PathSize -LiteralPath $safePath
    if ($PSCmdlet.ShouldProcess($safePath, $Label)) {
        Remove-Item -LiteralPath $safePath -Recurse -Force -ErrorAction Stop
        $script:removedCount++
        $script:bytesFreed += $size
        if (-not $Fast) { Write-Host "Removed: $safePath" -ForegroundColor Gray }
    }
}

function Get-ExistingChildren {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$NamePattern
    )

    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        return @()
    }
    return @(Get-ChildItem -LiteralPath $Root -Force -ErrorAction Stop |
        Where-Object { $_.Name -match $NamePattern })
}

try {
    $rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path
    $tempRoot = Get-NormalizedFullPath -Path ([System.IO.Path]::GetTempPath())
    $desktopRoot = Get-NormalizedFullPath -Path ([Environment]::GetFolderPath("Desktop"))

    if (-not $Fast) {
        Write-Host "OnlyRag V2 cleanup - mode: $Mode" -ForegroundColor Cyan
    }

    if ($StopAppProcesses) {
        $runningProcesses = @(Get-Process -Name "OnlyRag V2" -ErrorAction SilentlyContinue)
        foreach ($process in $runningProcesses) {
            if ($PSCmdlet.ShouldProcess("PID $($process.Id)", "Stop OnlyRag V2 process")) {
                Stop-Process -Id $process.Id -Force -ErrorAction Stop
            }
        }
    }

    if ($Mode -in @("Repo", "Full")) {
        $cleanRepoScript = Join-Path $PSScriptRoot "clean_repo.ps1"
        & $cleanRepoScript -WhatIf:$WhatIfPreference -Confirm:$false
        if ($LASTEXITCODE -ne 0) {
            throw "clean_repo.ps1 non riuscito (exit code $LASTEXITCODE)."
        }
    }

    if ($Mode -in @("Logs", "UserData", "Full") -or $CleanLogs) {
        $logRoots = @(
            @{ Path = Join-Path $env:APPDATA "onlyrag-v2\logs"; Root = $env:APPDATA },
            @{ Path = Join-Path $env:LOCALAPPDATA "OnlyRagV2\logs"; Root = $env:LOCALAPPDATA },
            @{ Path = Join-Path $env:USERPROFILE ".onlyragv2\logs"; Root = $env:USERPROFILE },
            @{ Path = Join-Path $env:USERPROFILE ".onlyrag_v2\logs"; Root = $env:USERPROFILE },
            @{ Path = Join-Path $rootDir "logs"; Root = $rootDir },
            @{ Path = Join-Path $rootDir "userdata_dev\logs"; Root = $rootDir }
        )
        foreach ($entry in $logRoots) {
            Remove-OwnedPath -Path $entry.Path -AllowedRoot $entry.Root -Label "Remove OnlyRag log directory"
        }

        foreach ($file in (Get-ExistingChildren -Root $tempRoot -NamePattern "^(?i:onlyrag.*\.log(?:\..*)?)$")) {
            Remove-OwnedPath -Path $file.FullName -AllowedRoot $tempRoot -Label "Remove OnlyRag temporary log"
        }
    }

    if ($Mode -in @("TestResidues", "Full")) {
        foreach ($relativePath in @(".onlyrag", "userdata_dev")) {
            Remove-OwnedPath `
                -Path (Join-Path $rootDir $relativePath) `
                -AllowedRoot $rootDir `
                -Label "Remove repository-local test data"
        }

        $tempPattern = "^(?i:onlyrag(?:-|_).+|OnlyRagV2_userData|slm-diag-test-\d+)$"
        foreach ($entry in (Get-ExistingChildren -Root $tempRoot -NamePattern $tempPattern)) {
            Remove-OwnedPath -Path $entry.FullName -AllowedRoot $tempRoot -Label "Remove OnlyRag test residue"
        }

        foreach ($entry in (Get-ExistingChildren -Root $desktopRoot -NamePattern "^(?i:onlyrag_live(?:_|$).*)$")) {
            Remove-OwnedPath -Path $entry.FullName -AllowedRoot $desktopRoot -Label "Remove OnlyRag live-test workspace"
        }
    }

    if ($Mode -in @("InstallerCache", "Full")) {
        Remove-OwnedPath `
            -Path (Join-Path $env:LOCALAPPDATA "onlyrag-v2-updater") `
            -AllowedRoot $env:LOCALAPPDATA `
            -Label "Remove OnlyRag installer updater cache"
    }

    if ($Mode -in @("UserData", "Full")) {
        $userDataRoots = @(
            @{ Path = Join-Path $env:LOCALAPPDATA "OnlyRagV2"; Root = $env:LOCALAPPDATA },
            @{ Path = Join-Path $env:APPDATA "onlyrag-v2"; Root = $env:APPDATA },
            @{ Path = Join-Path $env:USERPROFILE ".onlyragv2"; Root = $env:USERPROFILE },
            @{ Path = Join-Path $env:USERPROFILE ".onlyrag_v2"; Root = $env:USERPROFILE }
        )
        foreach ($entry in $userDataRoots) {
            Remove-OwnedPath -Path $entry.Path -AllowedRoot $entry.Root -Label "Remove OnlyRag user data"
        }
    }

    $freedMB = [math]::Round($script:bytesFreed / 1MB, 2)
    Write-Host "[PASS] Cleanup complete: $($script:removedCount) path(s), $freedMB MB freed." -ForegroundColor Green
    exit 0
} catch {
    Write-Host "[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
