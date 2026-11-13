# Shared retained fixture storage for PowerShell entry points and their subprocesses.
function New-RetainedTestFixture([string]$Prefix) {
    $result = & node (Join-Path $PSScriptRoot 'fixtureCli.mjs') create $Prefix
    if ($LASTEXITCODE -ne 0 -or -not $result) { throw 'Could not allocate an owned test fixture.' }
    $ceiling = ([IO.DirectoryInfo][string]$result).Parent.Parent.Parent.FullName
    $env:GIT_CEILING_DIRECTORIES = (@($env:GIT_CEILING_DIRECTORIES, $ceiling) | Where-Object { $_ } | Select-Object -Unique) -join [IO.Path]::PathSeparator
    return [string]$result
}

function Complete-RetainedTestFixture([string]$Path) {
    & node (Join-Path $PSScriptRoot 'fixtureCli.mjs') retain $Path
    if ($LASTEXITCODE -ne 0) { throw 'Could not record test fixture retention.' }
    Write-Host "Retained fixture: $Path"
}
