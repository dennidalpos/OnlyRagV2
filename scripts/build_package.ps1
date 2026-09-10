<#
.SYNOPSIS
    Script di build e packaging NSIS per OnlyRag V2 con Fail-Fast rigoroso.
.DESCRIPTION
    Valida gli asset, esegue il typecheck TypeScript, compila sidecar e bundle,
    genera l'installer NSIS di produzione e verifica contenuto, firma e hash dell'artefatto.
.PARAMETER SkipSidecar
    Salta la compilazione PyInstaller per il sidecar Python.
.PARAMETER Fast
    Modalità sintetica veloce per AI Agent.
.PARAMETER RequireSignature
    Fallisce se l'installer prodotto non risulta firmato con un certificato valido
    (per le build di distribuzione: richiede CSC_LINK/CSC_KEY_PASSWORD nell'ambiente).
#>

[CmdletBinding()]
param(
    [switch]$SkipSidecar = $false,
    [switch]$Fast = $false,
    [switch]$RequireSignature = $false
)

$ErrorActionPreference = "Stop"
if (Test-Path Variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $true
}
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-Sha256 {
    param([Parameter(Mandatory)][string]$Path)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
    } finally {
        $stream.Dispose()
        $sha256.Dispose()
    }
}

try {
    $rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path
    Push-Location $rootDir

    if (-not $Fast) {
        Write-Host "=====================================================" -ForegroundColor Cyan
        Write-Host " OnlyRag V2 - Build & NSIS Packaging Script" -ForegroundColor Cyan
        Write-Host "=====================================================" -ForegroundColor Cyan
    }

    # 1. Validazione asset condivisi da Electron e NSIS
    if (-not $Fast) { Write-Host "`n[1/6] Validazione asset applicazione e installer..." -ForegroundColor Yellow }
    $assetScript = Join-Path -Path $PSScriptRoot -ChildPath "generate_assets.ps1"
    & $assetScript -Check
    if ($LASTEXITCODE -ne 0) {
        throw "[ERRORE] Asset non validi. Eseguire npm run assets:generate e ripetere."
    }

    # 2. Verifica Tipo & Sintassi TypeScript
    if (-not $Fast) { Write-Host "`n[2/6] Esecuzione TypeScript Typecheck..." -ForegroundColor Yellow }
    npm run typecheck
    if ($LASTEXITCODE -ne 0) {
        throw "[ERRORE] Typecheck fallito con codice di uscita $LASTEXITCODE. Interruzione immediata."
    }
    if (-not $Fast) { Write-Host "[OK] Typecheck superato con successo." -ForegroundColor Green }

    # 3. Compilazione PyInstaller Standalone Executable per Sidecar Python
    if (-not $Fast) { Write-Host "`n[3/6] Compilazione PyInstaller Standalone Executable per Sidecar Python..." -ForegroundColor Yellow }
    $rootDir = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path
    $isWindowsHost = $IsWindows -or $env:OS -eq 'Windows_NT'
    $venvBinDir = if ($isWindowsHost) { "Scripts" } else { "bin" }
    $pyinstallerExeName = if ($isWindowsHost) { "pyinstaller.exe" } else { "pyinstaller" }
    $venvPythonExeName = if ($isWindowsHost) { "python.exe" } else { "python" }
    $venvPython = Join-Path (Join-Path $rootDir ".venv") (Join-Path $venvBinDir $venvPythonExeName)
    $venvPyInstaller = Join-Path (Join-Path $rootDir ".venv") (Join-Path $venvBinDir $pyinstallerExeName)

    if (-not $SkipSidecar) {
        if (-not (Test-Path -LiteralPath $venvPython)) {
            throw "[ERRORE] Python del virtualenv non trovato in $venvPython. Eseguire npm run setup:dev."
        }
        $venvPythonVersion = (& $venvPython --version 2>&1).ToString()
        if ($LASTEXITCODE -ne 0 -or $venvPythonVersion -notmatch 'Python 3\.12\.') {
            throw "[ERRORE] Virtualenv non compatibile: rilevato $venvPythonVersion, richiesto Python 3.12. Eseguire npm run setup:dev."
        }
        if (-not (Test-Path -LiteralPath $venvPyInstaller)) {
            throw "[ERRORE] PyInstaller non trovato in $venvPyInstaller. Eseguire npm run setup:dev."
        }
        & $venvPython -c "import importlib.metadata as metadata; metadata.version('onnxruntime-gpu')"
        if ($LASTEXITCODE -ne 0) {
            throw "[ERRORE] onnxruntime-gpu non installato. Eseguire npm run setup:dev prima del packaging."
        }
        # --distpath must point to sidecar_dist (not PyInstaller's default ./dist), which is what
        # package.json's electron-builder extraResources actually reads from. Without this flag,
        # PyInstaller wrote to ./dist/sidecar, colliding with -- and getting wiped by -- the
        # subsequent "vite build" step's emptyOutDir, so the installer silently shipped without
        # the bundled sidecar executable despite the script reporting success.
        & $venvPyInstaller --noconfirm --distpath "$rootDir\sidecar_dist" "$rootDir\sidecar.spec"
        if ($LASTEXITCODE -ne 0) {
            throw "[ERRORE] Compilazione PyInstaller Sidecar fallita con codice $LASTEXITCODE."
        }
        $sidecarExe = Join-Path $rootDir "sidecar_dist\sidecar\sidecar.exe"
        if (-not (Test-Path -LiteralPath $sidecarExe)) {
            throw "[ERRORE] PyInstaller ha terminato senza produrre $sidecarExe."
        }
        if (-not $Fast) { Write-Host "[OK] Standalone sidecar.exe generato con successo in sidecar_dist/sidecar." -ForegroundColor Green }
    } else {
        if (-not $Fast) { Write-Host "[WARN] Flag SkipSidecar attivo: l'installer non includerà il sidecar standalone." -ForegroundColor Yellow }
    }

    # 4. Compilazione Bundle Vite & Smoke Test del Main Process
    if (-not $Fast) { Write-Host "`n[4/6] Compilazione bundle Vite e Smoke Test del Main Process..." -ForegroundColor Yellow }
    $smokeScript = Join-Path -Path $PSScriptRoot -ChildPath "test_bundle_smoke.ps1"
    & $smokeScript -Fast
    if ($LASTEXITCODE -ne 0) {
        throw "[ERRORE] Smoke test del bundle Electron fallito con codice di uscita $LASTEXITCODE. Interruzione immediata."
    }
    if (-not $Fast) { Write-Host "[OK] Bundle Electron verificato con successo dallo smoke test." -ForegroundColor Green }

    # 5. Impacchettamento NSIS tramite electron-builder
    if (-not $Fast) { Write-Host "`n[5/6] Avvio impacchettamento NSIS (electron-builder)..." -ForegroundColor Yellow }
    if (-not $SkipSidecar -and -not (Test-Path -LiteralPath (Join-Path $rootDir "sidecar_dist\sidecar"))) {
        throw "[ERRORE] Sorgente sidecar mancante prima del packaging NSIS."
    }
    $distPath = Join-Path $rootDir "dist"
    if (Test-Path $distPath) {
        $staleTargets = @(
            (Join-Path $distPath "win-unpacked")
        ) + @(Get-ChildItem -LiteralPath $distPath -Filter "*.exe" -File -ErrorAction Stop | Select-Object -ExpandProperty FullName) +
            @(Get-ChildItem -LiteralPath $distPath -Filter "*.blockmap" -File -ErrorAction Stop | Select-Object -ExpandProperty FullName)
        foreach ($staleTarget in $staleTargets) {
            if (Test-Path -LiteralPath $staleTarget) {
                Remove-Item -LiteralPath $staleTarget -Recurse -Force -ErrorAction Stop
            }
        }
    }
    npx --no-install electron-builder --win nsis --x64
    if ($LASTEXITCODE -ne 0) {
        throw "[ERRORE] Impacchettamento NSIS fallito con codice di uscita $LASTEXITCODE. Interruzione immediata."
    }
    if (-not $Fast) { Write-Host "[OK] Impacchettamento completato." -ForegroundColor Green }

    # 6. Validazione artifact NSIS generati
    if (-not $Fast) { Write-Host "`n[6/6] Verifica degli artifact di installazione NSIS in dist/..." -ForegroundColor Yellow }
    $distPath = Join-Path $rootDir "dist"
    $nsisInstaller = Get-ChildItem -Path $distPath -Filter "*.exe" | Where-Object { $_.Name -like "*Setup*.exe" } | Select-Object -First 1

    if ($null -eq $nsisInstaller) {
        throw "[ERRORE] Nessun installer NSIS (*Setup*.exe) trovato nella cartella dist! Interruzione immediata."
    }

    $unpackedExecutable = Join-Path $distPath "win-unpacked\OnlyRag V2.exe"
    if (-not (Test-Path -LiteralPath $unpackedExecutable -PathType Leaf)) {
        throw "[ERRORE] Eseguibile unpacked mancante: $unpackedExecutable"
    }
    if (-not $SkipSidecar) {
        $packagedSidecar = Join-Path $distPath "win-unpacked\resources\sidecar\sidecar.exe"
        if (-not (Test-Path -LiteralPath $packagedSidecar -PathType Leaf)) {
            throw "[ERRORE] L'installer non contiene il sidecar atteso: $packagedSidecar"
        }
    }

    $sizeMB = [math]::Round($nsisInstaller.Length / 1MB, 2)
    $sha256 = Get-Sha256 -Path $nsisInstaller.FullName

    # Firma Authenticode: electron-builder logga l'invocazione di signtool anche quando nessun
    # certificato e' configurato, quindi l'unico controllo affidabile e' lo stato dell'artifact.
    # Get-AuthenticodeSignature vive in Microsoft.PowerShell.Security, e in una shell non
    # interattiva quel modulo non sempre si carica: lo step 4/4 moriva con "comando trovato nel
    # modulo ... ma impossibile caricare il modulo" e buttava via un pacchetto costruito
    # correttamente. Uno stato di firma NON DETERMINABILE non e' un pacchetto rotto, quindi
    # blocca la build solo quando la firma e' stata richiesta esplicitamente.
    $signature = $null
    try {
        $signature = Get-AuthenticodeSignature -FilePath $nsisInstaller.FullName -ErrorAction Stop
    } catch {
        if ($RequireSignature) {
            throw "[ERRORE] Impossibile verificare la firma dell'installer: $($_.Exception.Message)"
        }
        Write-Host "[WARN] Stato della firma non verificabile in questo contesto ($($_.Exception.Message)). Il pacchetto e' stato prodotto comunque." -ForegroundColor Yellow
    }

    $signatureStatus = if ($signature) { $signature.Status } else { 'NonVerificabile' }
    $isSigned = $signatureStatus -eq 'Valid'
    $signatureLabel = if ($isSigned) { "firmato ($($signature.SignerCertificate.Subject))" } else { "NON firmato ($signatureStatus)" }

    if (-not $isSigned -and $signature) {
        if ($RequireSignature) {
            throw "[ERRORE] Installer non firmato (stato: $signatureStatus). Imposta CSC_LINK e CSC_KEY_PASSWORD con il certificato di code signing e ripeti la build."
        }
        Write-Host "[WARN] Installer NON firmato (stato: $signatureStatus): all'avvio Windows SmartScreen mostrera' l'avviso 'Editore sconosciuto'. Per una build di distribuzione imposta CSC_LINK/CSC_KEY_PASSWORD ed esegui lo script con -RequireSignature." -ForegroundColor Yellow
    }

    if ($Fast) {
        Write-Host "[PASS] Build & NSIS Packaging Complete: $($nsisInstaller.Name) ($sizeMB MB, $signatureLabel, SHA256 $sha256)" -ForegroundColor Green
    } else {
        Write-Host "`n=====================================================" -ForegroundColor Green
        Write-Host " PACKAGING NSIS COMPLETATO CON SUCCESSO!" -ForegroundColor Green
        Write-Host " File: $($nsisInstaller.FullName)" -ForegroundColor White
        Write-Host " Dimensione: $sizeMB MB" -ForegroundColor White
        Write-Host " Firma: $signatureLabel" -ForegroundColor White
        Write-Host " SHA256: $sha256" -ForegroundColor White
        Write-Host "=====================================================" -ForegroundColor Green
    }

    exit 0
} catch {
    Write-Host "`n[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
