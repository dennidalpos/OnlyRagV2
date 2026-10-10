[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('onlyrag-cleanup-policy-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object System.Text.UTF8Encoding($false)
$failures = New-Object System.Collections.Generic.List[string]
$cases = 0

function Write-FixtureFile([string]$Path, [string]$Content = 'retained fixture') {
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Invoke-Case([string]$Name, [string]$Script, [hashtable]$Parameters, [int]$ExpectedExit, [string]$ExpectedText) {
    $script:cases++
    $payloadPath = Join-Path $fixtureRoot 'invocation.json'
    [IO.File]::WriteAllText($payloadPath, (@{ entry = $Script; parameters = $Parameters; fixtureRoot = $fixtureRoot } | ConvertTo-Json -Depth 8), $utf8)
    $previousPreference = $ErrorActionPreference
    try {
        # Windows PowerShell wraps expected native stderr as non-terminating errors.
        $ErrorActionPreference = 'Continue'
        $output = @(& powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $fixtureRoot 'invoke.ps1') -PayloadPath $payloadPath 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    $text = $output -join "`n"
    if ($code -ne $ExpectedExit -or ($ExpectedText -and $text -notmatch [regex]::Escape($ExpectedText))) {
        $failures.Add("$Name : exit=$code expected=$ExpectedExit; $text")
    }
}

try {
    $repo = Join-Path $fixtureRoot 'repo'
    [void][IO.Directory]::CreateDirectory((Join-Path $repo 'scripts'))
    foreach ($name in @('clean_repo.ps1', 'clean_workspace.ps1', 'cleanup_policy.ps1')) {
        $source = Join-Path $repositoryRoot "scripts\$name"
        if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $repo "scripts\$name") }
    }
    & git -C $repo init --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Fixture git init failed.' }
    Write-FixtureFile (Join-Path $repo 'dist\tracked.txt')
    & git -C $repo add -- dist/tracked.txt
    if ($LASTEXITCODE -ne 0) { throw 'Fixture git add failed.' }
    Write-FixtureFile (Join-Path $repo 'dist-electron\main.js') 'compiled fixture'
    Write-FixtureFile (Join-Path $repo '.onlyrag\sessions\history.json')
    Write-FixtureFile (Join-Path $repo 'userdata_dev\settings.json')
    Write-FixtureFile (Join-Path $repo 'build\tabular-probes\evidence.txt')
    Write-FixtureFile (Join-Path $repo 'out\retained.bak')
    Write-FixtureFile (Join-Path $repo 'release\diagnosis.log')
    Write-FixtureFile (Join-Path $repo 'coverage\report.txt')
    Write-FixtureFile (Join-Path $repo 'coverage\nested\.onlyrag\snapshot.json')
    Write-FixtureFile (Join-Path $fixtureRoot 'temp\disposable\fixture.txt')
    Write-FixtureFile (Join-Path $fixtureRoot 'temp\onlyrag-prefix\sessions\history.json')
    Write-FixtureFile (Join-Path $fixtureRoot 'profile\OnlyRag-Live\evidence.txt')
    Write-FixtureFile (Join-Path $fixtureRoot 'configured-live\evidence.txt')
    Write-FixtureFile (Join-Path $fixtureRoot 'roaming\onlyrag-v2\logs\fixture.txt')
    Write-FixtureFile (Join-Path $fixtureRoot 'local\onlyrag-v2-updater\fixture.txt')

    $invoke = @'
param([string]$PayloadPath)
$ErrorActionPreference = 'Stop'
$payload = Get-Content -LiteralPath $PayloadPath -Raw | ConvertFrom-Json
$env:TEMP = Join-Path $payload.fixtureRoot 'temp'
$env:TMP = $env:TEMP
$env:USERPROFILE = Join-Path $payload.fixtureRoot 'profile'
$env:APPDATA = Join-Path $payload.fixtureRoot 'roaming'
$env:LOCALAPPDATA = Join-Path $payload.fixtureRoot 'local'
$env:ONLYRAG_LIVE_ROOT = Join-Path $payload.fixtureRoot 'configured-live'
$parameters = @{ WhatIf = $true }
foreach ($property in $payload.parameters.PSObject.Properties) { $parameters[$property.Name] = $property.Value }
& $payload.entry @parameters
exit $LASTEXITCODE
'@
    Write-FixtureFile (Join-Path $fixtureRoot 'invoke.ps1') $invoke
    $repoScript = Join-Path $repo 'scripts\clean_repo.ps1'
    $workspaceScript = Join-Path $repo 'scripts\clean_workspace.ps1'
    Invoke-Case 'Repo needs explicit selection' $repoScript @{} 1 'DisposablePaths'
    Invoke-Case 'Tests need explicit selection' $workspaceScript @{ Mode = 'TestResidues' } 1 'DisposablePaths'
    Invoke-Case 'Full needs explicit selection' $workspaceScript @{ Mode = 'Full' } 1 'DisposablePaths'
    Invoke-Case 'Disposable generated candidate' $repoScript @{ DisposablePaths = @((Join-Path $repo 'dist-electron')) } 0 'Remove explicitly reviewed'
    Invoke-Case 'Overlapping selections' $repoScript @{ DisposablePaths = @((Join-Path $repo 'dist-electron'), (Join-Path $repo 'dist-electron\main.js')) } 1 'overlapping'
    Invoke-Case 'Source directories are not outputs' $repoScript @{ DisposablePaths = @((Join-Path $repo 'scripts')) } 1 'outside generated'
    Invoke-Case 'Literal brackets remain literal' $repoScript @{ DisposablePaths = @((Join-Path $repo 'dist-electron\absent[1].js')) } 1 'exist'
    Invoke-Case 'Tracked descendant' $repoScript @{ DisposablePaths = @((Join-Path $repo 'dist')) } 1 'tracked'
    Invoke-Case 'Root selection' $repoScript @{ DisposablePaths = @($repo) } 1 'root'
    Invoke-Case 'Sibling traversal' $repoScript @{ DisposablePaths = @((Join-Path $repo '..\sibling')) } 1 'outside'
    Invoke-Case 'Retained tabular evidence via parent' $repoScript @{ DisposablePaths = @((Join-Path $repo 'build')) } 1 'protected'
    Invoke-Case 'Backup retention' $repoScript @{ DisposablePaths = @((Join-Path $repo 'out')) } 1 'protected'
    Invoke-Case 'Log evidence retention' $repoScript @{ DisposablePaths = @((Join-Path $repo 'release')) } 1 'protected'
    Invoke-Case 'Nested state retention' $repoScript @{ DisposablePaths = @((Join-Path $repo 'coverage')) } 1 'protected'
    Invoke-Case 'Workspace state' $workspaceScript @{ Mode = 'TestResidues'; DisposablePaths = @((Join-Path $repo '.onlyrag')) } 1 'protected'
    Invoke-Case 'Development profile' $workspaceScript @{ Mode = 'TestResidues'; DisposablePaths = @((Join-Path $repo 'userdata_dev')) } 1 'protected'
    Invoke-Case 'Prefix is not ownership' $workspaceScript @{ Mode = 'TestResidues'; DisposablePaths = @((Join-Path $fixtureRoot 'temp\onlyrag-prefix')) } 1 'protected'
    Invoke-Case 'Explicit temporary fixture' $workspaceScript @{ Mode = 'TestResidues'; DisposablePaths = @((Join-Path $fixtureRoot 'temp\disposable')) } 0 'Remove explicitly reviewed'
    Invoke-Case 'Default live root' $workspaceScript @{ Mode = 'TestResidues'; DisposablePaths = @((Join-Path $fixtureRoot 'profile\OnlyRag-Live')) } 1 'protected'
    Invoke-Case 'Configured live root' $workspaceScript @{ Mode = 'TestResidues'; DisposablePaths = @((Join-Path $fixtureRoot 'configured-live')) } 1 'protected'
    Invoke-Case 'Mixed selection fails before delegation' $workspaceScript @{ Mode = 'Full'; DisposablePaths = @((Join-Path $repo 'dist-electron'), (Join-Path $repo '.onlyrag')) } 1 'protected'
    Invoke-Case 'Explicit Full repository delegation' $workspaceScript @{ Mode = 'Full'; DisposablePaths = @((Join-Path $repo 'dist-electron')) } 0 'Remove explicitly reviewed'
    Invoke-Case 'Full preserves profile' $workspaceScript @{ Mode = 'Full'; DisposablePaths = @((Join-Path $fixtureRoot 'roaming\onlyrag-v2')) } 1 'protected'
    Invoke-Case 'UserData remains an explicitly separate scope' $workspaceScript @{ Mode = 'UserData' } 0 'Remove explicitly reviewed'
    Invoke-Case 'Name-based stop refused' $workspaceScript @{ Mode = 'Logs'; StopAppProcesses = $true } 1 'identity'
    Invoke-Case 'Combined logs require separate scope' $workspaceScript @{ Mode = 'Repo'; CleanLogs = $true } 1 'separate Logs'
    Invoke-Case 'Separately selected logs' $workspaceScript @{ Mode = 'Logs' } 0 'Remove explicitly reviewed'
    Invoke-Case 'Separately selected installer cache' $workspaceScript @{ Mode = 'InstallerCache' } 0 'Remove explicitly reviewed'

    $junction = Join-Path $repo 'test-results'
    New-Item -ItemType Junction -Path $junction -Target (Join-Path $fixtureRoot 'temp\disposable') | Out-Null
    Invoke-Case 'Reparse target' $repoScript @{ DisposablePaths = @($junction) } 1 'reparse'
    Invoke-Case 'Reparse ancestor' $repoScript @{ DisposablePaths = @((Join-Path $junction 'fixture.txt')) } 1 'reparse'
    [IO.Directory]::Delete($junction)
    $junction = Join-Path $repo 'dist-electron\linked'
    New-Item -ItemType Junction -Path $junction -Target (Join-Path $fixtureRoot 'temp\disposable') | Out-Null
    Invoke-Case 'Reparse descendant' $repoScript @{ DisposablePaths = @((Join-Path $repo 'dist-electron')) } 1 'reparse'
    [IO.Directory]::Delete($junction)

    if ($failures.Count) { throw ($failures -join "`n") }
    if (-not (Test-Path -LiteralPath (Join-Path $repo 'dist-electron\main.js'))) { throw 'WhatIf modified fixture data.' }
    Write-Host "PASS cleanup policy: $cases isolated WhatIf cases; no cleanup or process termination."
} finally {
    $resolved = [IO.Path]::GetFullPath($fixtureRoot)
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture teardown path.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
