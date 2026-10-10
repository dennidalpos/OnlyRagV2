# Shared preflight for explicit disposal decisions; no deletion or process discovery.
Set-StrictMode -Version 3.0

function Get-CleanupFullPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path) -or [IO.Path]::GetPathRoot($Path).Length -le 2) {
        throw 'Cleanup requires an absolute filesystem path.'
    }
    return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Test-CleanupWithin([string]$Path, [string]$Root, [switch]$IncludeRoot) {
    if ($IncludeRoot -and $Path.Equals($Root, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $Path.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Get-RepoCleanupRoots([string]$RepositoryRoot) {
    @('build', 'dist', 'dist-electron', 'out', 'release', 'sidecar_dist', 'scripts\build', 'scripts\dist',
      '.vite', 'node_modules\.vite', 'node_modules\.cache', '.pytest_cache', 'sidecar\.pytest_cache',
      '.ruff_cache', '.mypy_cache', '.cache', 'coverage', '.nyc_output', 'test-results', 'htmlcov') |
        ForEach-Object { Get-CleanupFullPath (Join-Path $RepositoryRoot $_) }
}

function Get-ExplicitWorkspaceCleanupRoots([string]$RepositoryRoot, [string]$Mode) {
    switch ($Mode) {
        'Logs' {
            @((Join-Path $env:APPDATA 'onlyrag-v2\logs'), (Join-Path $env:APPDATA 'OnlyRag V2\logs'),
              (Join-Path $env:LOCALAPPDATA 'OnlyRagV2\logs'), (Join-Path $RepositoryRoot 'logs'))
        }
        'InstallerCache' { Join-Path $env:LOCALAPPDATA 'onlyrag-v2-updater' }
        'UserData' {
            @((Join-Path $env:LOCALAPPDATA 'OnlyRagV2'), (Join-Path $env:APPDATA 'onlyrag-v2'), (Join-Path $env:APPDATA 'OnlyRag V2'))
        }
    }
}

function Assert-NoCleanupReparseAncestors([string]$Path) {
    $current = $Path
    while ($current) {
        # Get-Item also exposes a dangling link; Test-Path alone can treat it as absent.
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Cleanup refuses reparse path: $current"
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}

function Assert-CleanupSelection([string[]]$Paths, [string]$RepositoryRoot, [string]$Mode) {
    if (-not $Paths -or $Paths.Count -eq 0) { throw 'DisposablePaths must list exact paths reviewed for disposal.' }
    $repo = Get-CleanupFullPath $RepositoryRoot
    $temp = Get-CleanupFullPath ([IO.Path]::GetTempPath())
    $desktopPath = [Environment]::GetFolderPath('Desktop')
    $allowedRoots = @($repo, $temp)
    if ($desktopPath) { $allowedRoots += Get-CleanupFullPath $desktopPath }
    if ($Mode -in @('Logs', 'UserData', 'InstallerCache')) {
        $allowedRoots += Get-CleanupFullPath $env:APPDATA
        $allowedRoots += Get-CleanupFullPath $env:LOCALAPPDATA
    }
    $repoOutputs = @(Get-RepoCleanupRoots $repo)
    $explicitRoots = @(Get-ExplicitWorkspaceCleanupRoots $repo $Mode | ForEach-Object { Get-CleanupFullPath $_ })
    $protected = @((Join-Path $repo '.onlyrag'), (Join-Path $repo 'userdata_dev'), (Join-Path $repo 'build\tabular-probes'),
      (Join-Path $repo 'data'), (Join-Path $repo 'export'), (Join-Path $repo 'lancedb_store'), (Join-Path $repo '.git'),
      (Join-Path $repo '.venv'), (Join-Path $env:USERPROFILE 'OnlyRag-Live'), (Join-Path $env:USERPROFILE '.ollama'))
    if ($desktopPath) { $protected += Join-Path $desktopPath 'test_app' }
    if ($env:ONLYRAG_LIVE_ROOT) { $protected += $env:ONLYRAG_LIVE_ROOT }
    if ($env:OLLAMA_MODELS) { $protected += $env:OLLAMA_MODELS }
    if ($Mode -notin @('Logs', 'UserData')) { $protected += Get-ExplicitWorkspaceCleanupRoots $repo 'UserData' }
    $protected = @($protected | ForEach-Object { Get-CleanupFullPath $_ })
    $tracked = @(& git -C $repo -c core.quotepath=false ls-files)
    if ($LASTEXITCODE -ne 0) { throw 'Cleanup cannot establish tracked paths.' }
    $trackedAbsolute = @($tracked | ForEach-Object {
        if ($_.StartsWith('"')) { throw 'Cleanup refuses unsupported quoted Git filenames.' }
        Get-CleanupFullPath (Join-Path $repo $_)
    })
    $selected = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($candidate in $Paths) {
        $full = Get-CleanupFullPath $candidate
        if ($allowedRoots -contains $full) { throw "Cleanup refuses a root target: $full" }
        foreach ($protectedRoot in $protected) {
            if ((Test-CleanupWithin $full $protectedRoot -IncludeRoot) -or (Test-CleanupWithin $protectedRoot $full -IncludeRoot)) {
                throw "Cleanup refuses protected path/evidence: $full"
            }
        }
        if (-not ($allowedRoots | Where-Object { Test-CleanupWithin $full $_ })) { throw "Cleanup target is outside allowed roots: $full" }
        if ($Mode -eq 'Repo' -or ($Mode -eq 'Full' -and (Test-CleanupWithin $full $repo))) {
            if (-not ($repoOutputs | Where-Object { Test-CleanupWithin $full $_ -IncludeRoot })) {
                throw "Cleanup target is outside generated repository outputs: $full"
            }
        } elseif ($Mode -in @('Logs', 'UserData', 'InstallerCache')) {
            if ($explicitRoots -notcontains $full) { throw "Cleanup target is outside the explicit $Mode scope: $full" }
        }
        if (-not (Test-Path -LiteralPath $full)) { throw "Cleanup target does not exist: $full" }
        Assert-NoCleanupReparseAncestors $full
        foreach ($trackedPath in $trackedAbsolute) {
            if (Test-CleanupWithin $trackedPath $full -IncludeRoot) { throw "Cleanup refuses tracked path/descendant: $full" }
        }
        $pending = New-Object 'System.Collections.Generic.Stack[string]'
        $pending.Push($full)
        while ($pending.Count) {
            $entry = Get-Item -LiteralPath $pending.Pop() -Force -ErrorAction Stop
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Cleanup refuses reparse descendant: $($entry.FullName)" }
            if ($entry.Name -in @('.git', '.onlyrag', 'userdata_dev', 'source-documents', 'checkpoints', 'sessions', 'lancedb_store', 'document-recovery.json', 'sidecar-ownership.json') -or
                $entry.Name -match '(?i)\.(bak|orig|rej|log(?:\..*)?)$|^\.agent_state_') {
                throw "Cleanup refuses protected state/backup/evidence: $($entry.FullName)"
            }
            if ($entry.PSIsContainer) {
                foreach ($child in (Get-ChildItem -LiteralPath $entry.FullName -Force -ErrorAction Stop)) { $pending.Push($child.FullName) }
            }
        }
        [void]$selected.Add($full)
    }
    # Avoid selecting both a parent and a child; neither selection can change the other's checks.
    foreach ($path in $selected) {
        foreach ($other in $selected) {
            if ($path -ne $other -and (Test-CleanupWithin $path $other)) { throw 'Cleanup refuses overlapping selections.' }
        }
    }
    return @($selected | Sort-Object)
}
