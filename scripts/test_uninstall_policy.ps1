[CmdletBinding()]
param([string]$Compiler)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $Compiler) {
    $cache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis'
    $Compiler = Get-ChildItem -LiteralPath $cache -Filter makensis.exe -File -Recurse |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Compiler -or -not (Test-Path -LiteralPath $Compiler)) { throw 'NSIS compiler not found; run Windows packaging first.' }
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('onlyrag-uninstall-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Invoke-Fixture([string]$Executable, [string]$Arguments, [int]$ExpectedExit = 0) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(30000)) {
        Stop-Process -Id $process.Id -Force
        throw 'Own uninstall fixture timed out.'
    }
    if ($process.ExitCode -ne $ExpectedExit) { throw "Fixture returned $($process.ExitCode), expected $ExpectedExit." }
}

try {
    New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
    # Only shell-folder paths are redirected; the production macros and page compile unchanged.
    $include = [IO.File]::ReadAllText((Join-Path $repositoryRoot 'installer\installer.nsh'))
    $include = $include.Replace('$APPDATA', '$EXEDIR\fixtures\roaming').Replace('$LOCALAPPDATA', '$EXEDIR\fixtures\local').Replace('$PROFILE', '$EXEDIR\fixtures\profile')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'policy.nsh'), $include, $utf8)
    $source = @'
Unicode true
Name "OnlyRag isolated uninstall policy"
OutFile "fixture.exe"
RequestExecutionLevel user
SilentInstall silent
Var FixtureUpdated
Var installMode
!define BUILD_UNINSTALLER
!define isUpdated `"$FixtureUpdated" == "1"`
!include "policy.nsh"
!insertmacro customUnWelcomePage
UninstPage instfiles
!insertmacro MUI_LANGUAGE "English"
Section
  WriteUninstaller "$EXEDIR\uninstall.exe"
SectionEnd
Function un.onInit
  StrCpy $installMode "currentuser"
  StrCpy $FixtureUpdated "0"
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    StrCpy $FixtureUpdated "1"
  ${EndIf}
  !insertmacro customUnInit
  ClearErrors
  ${GetOptions} $R0 "--selected" $R1
  ${IfNot} ${Errors}
    StrCpy $OnlyRagDeleteData "1"
  ${EndIf}
FunctionEnd
Section "Uninstall"
  !insertmacro customUnInstall
SectionEnd
'@
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'fixture.nsi'), $source, $utf8)
    Push-Location $fixtureRoot
    try {
        & $Compiler /V2 fixture.nsi
        if ($LASTEXITCODE -ne 0) { throw "NSIS fixture compilation failed: $LASTEXITCODE." }
    } finally { Pop-Location }
    Invoke-Fixture (Join-Path $fixtureRoot 'fixture.exe') '/S'
    $targets = @('roaming\onlyrag-v2', 'roaming\OnlyRag V2', 'local\OnlyRagV2', 'local\onlyrag-v2', 'local\onlyrag-v2-updater', 'profile\.onlyragv2', 'profile\.onlyrag_v2')
    $cases = @(
        @{ Name = 'default-preserve'; Flags = ''; Deleted = $false; Exit = 0 },
        @{ Name = 'selected-opt-in'; Flags = '--selected'; Deleted = $true; Exit = 0 },
        @{ Name = 'explicit-silent-opt-in'; Flags = '--delete-app-data'; Deleted = $true; Exit = 0 },
        @{ Name = 'update-preserve'; Flags = '--updated --selected'; Deleted = $false; Exit = 0 },
        @{ Name = 'update-reject-delete'; Flags = '--updated --delete-app-data'; Deleted = $false; Exit = 2 }
    )
    foreach ($case in $cases) {
        foreach ($target in $targets) {
            $directory = Join-Path (Join-Path $fixtureRoot 'fixtures') $target
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
            [IO.File]::WriteAllText((Join-Path $directory 'sentinel.txt'), 'preserve', $utf8)
        }
        $unrelated = Join-Path $fixtureRoot 'fixtures\unrelated'
        New-Item -ItemType Directory -Path $unrelated -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $unrelated 'sentinel.txt'), 'preserve', $utf8)
        Invoke-Fixture (Join-Path $fixtureRoot 'uninstall.exe') "/S $($case.Flags) _?=$fixtureRoot" $case.Exit
        foreach ($target in $targets) {
            $sentinel = Join-Path (Join-Path (Join-Path $fixtureRoot 'fixtures') $target) 'sentinel.txt'
            if ((Test-Path -LiteralPath $sentinel) -eq $case.Deleted) { throw "Unexpected data outcome: $($case.Name), $target." }
        }
        if (-not (Test-Path -LiteralPath (Join-Path $unrelated 'sentinel.txt'))) { throw 'Unrelated data was removed.' }
        Write-Host "[PASS] $($case.Name)"
    }
} finally {
    $resolved = [IO.Path]::GetFullPath($fixtureRoot)
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\onlyrag-uninstall-'
    if (-not $resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup path.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
