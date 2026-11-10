[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('onlyrag-log-policy-' + [guid]::NewGuid().ToString('N'))
$cases = 0
function Write-Fixture([string]$Relative, [string]$Content = 'retained evidence') {
    $file = Join-Path $fixtureRoot $Relative
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null
    [IO.File]::WriteAllText($file, $Content)
}
function Invoke-Case([string]$Name, [hashtable]$Parameters, [int]$ExpectedCode) {
    $script:cases++
    $payload = Join-Path $fixtureRoot 'payload.json'
    [IO.File]::WriteAllText($payload, (@{ parameters = $Parameters; root = $fixtureRoot } | ConvertTo-Json -Depth 8))
    $output = & powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $fixtureRoot 'invoke.ps1') -Payload $payload 2>&1
    if ($LASTEXITCODE -ne $ExpectedCode) { throw "$Name : $output" }
}
try {
    $repo = Join-Path $fixtureRoot 'repo'
    [IO.Directory]::CreateDirectory((Join-Path $repo 'scripts')) | Out-Null
    foreach ($file in @('clean_workspace.ps1', 'clean_repo.ps1', 'cleanup_policy.ps1')) {
        Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts\$file") -Destination (Join-Path $repo "scripts\$file")
    }
    & git -C $repo init --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Fixture init failed' }
    foreach ($file in @('app.log', 'app.1.log', 'app.2.log', 'coding_agent_audit.log', 'coding_agent_audit.1.log', 'diagnosis.log', 'app.log.bak', 'app.3.log', 'app[1].log', 'capability-audit.jsonl')) {
        Write-Fixture "repo\logs\$file" $file
    }
    Write-Fixture 'repo\logs\source-documents\original.txt'
    Write-Fixture 'repo\userdata_dev\settings.json'
    Write-Fixture 'roaming\onlyrag-v2\logs\app.1.log'
    Write-Fixture 'local\OnlyRagV2\logs\app.1.log'
    Write-Fixture 'other\app.1.log'
    Write-Fixture 'invoke.ps1' @'
param([string]$Payload)
$ErrorActionPreference = 'Stop'
$data = Get-Content -LiteralPath $Payload -Raw | ConvertFrom-Json
$env:APPDATA = Join-Path $data.root 'roaming'
$env:LOCALAPPDATA = Join-Path $data.root 'local'
$parameters = @{ Mode = 'Logs' }
foreach ($entry in $data.parameters.PSObject.Properties) { $parameters[$entry.Name] = $entry.Value }
& (Join-Path $data.root 'repo\scripts\clean_workspace.ps1') @parameters
exit $LASTEXITCODE
'@
    $retained = @{}
    Get-ChildItem -LiteralPath $fixtureRoot -Recurse -File | Where-Object FullName -NotMatch '\\.git\\|\\scripts\\|invoke.ps1' | ForEach-Object { $retained[$_.FullName] = (Get-FileHash -LiteralPath $_.FullName).Hash }
    $oldLog = Join-Path $repo 'logs\app.1.log'
    Invoke-Case 'Missing explicit selection' @{} 1
    Invoke-Case 'Missing closed-app assertion' @{ DisposablePaths = @($oldLog) } 1
    Invoke-Case 'WhatIf preserves all bytes' @{ DisposablePaths = @($oldLog); ApplicationClosed = $true; WhatIf = $true } 0
    foreach ($entry in $retained.GetEnumerator()) { if ((Get-FileHash -LiteralPath $entry.Key).Hash -ne $entry.Value) { throw 'WhatIf changed bytes' } }
    foreach ($relative in @('logs', 'logs\diagnosis.log', 'logs\app.log.bak', 'logs\app.3.log', 'logs\app[1].log', 'logs\capability-audit.jsonl', 'userdata_dev\settings.json')) {
        Invoke-Case "Refuse $relative" @{ DisposablePaths = @((Join-Path $repo $relative)); ApplicationClosed = $true } 1
    }
    Invoke-Case 'Outside known roots' @{ DisposablePaths = @((Join-Path $fixtureRoot 'other\app.1.log')); ApplicationClosed = $true } 1
    Invoke-Case 'Mixed selections fail before any deletion' @{ DisposablePaths = @($oldLog, (Join-Path $repo 'logs\diagnosis.log')); ApplicationClosed = $true } 1
    if (-not (Test-Path -LiteralPath $oldLog)) { throw 'Mixed preflight deleted a valid candidate' }
    $junction = Join-Path $repo 'logs\junction'
    New-Item -ItemType Junction -Path $junction -Target (Join-Path $fixtureRoot 'other') | Out-Null
    Invoke-Case 'Junction outside exact roots' @{ DisposablePaths = @((Join-Path $junction 'app.1.log')); ApplicationClosed = $true } 1
    [IO.Directory]::Delete($junction)
    $linkedLog = Join-Path $repo 'logs\app.2.log'
    Remove-Item -LiteralPath $linkedLog
    New-Item -ItemType Junction -Path $linkedLog -Target (Join-Path $fixtureRoot 'other') | Out-Null
    Invoke-Case 'Recognized name is a reparse directory' @{ DisposablePaths = @($linkedLog); ApplicationClosed = $true } 1
    [IO.Directory]::Delete($linkedLog)
    Write-Fixture 'repo\logs\app.2.log' 'app.2.log'
    & git -C $repo add -- logs/app.2.log
    if ($LASTEXITCODE -ne 0) { throw 'Fixture git add failed' }
    Invoke-Case 'Tracked log refused' @{ DisposablePaths = @($linkedLog); ApplicationClosed = $true } 1
    $selected = @($oldLog, (Join-Path $fixtureRoot 'roaming\onlyrag-v2\logs\app.1.log'), (Join-Path $fixtureRoot 'local\OnlyRagV2\logs\app.1.log'))
    Invoke-Case 'Remove only the exact reviewed generations' @{ DisposablePaths = $selected; ApplicationClosed = $true } 0
    foreach ($file in $selected) { if (Test-Path -LiteralPath $file) { throw 'Selected log still exists' }; $retained.Remove($file) }
    foreach ($entry in $retained.GetEnumerator()) { if ((Get-FileHash -LiteralPath $entry.Key).Hash -ne $entry.Value) { throw "Retained bytes changed: $($entry.Key)" } }
    Invoke-Case 'Missing file reports refusal' @{ DisposablePaths = @($oldLog); ApplicationClosed = $true } 1
    Write-Output "PASS log cleanup: $cases isolated cases, actual selected-file deletion, retained byte hashes verified."
} finally {
    $absolute = [IO.Path]::GetFullPath($fixtureRoot)
    $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture teardown path' }
    if (Test-Path -LiteralPath $absolute) { Remove-Item -LiteralPath $absolute -Recurse -Force }
}
