<#
.SYNOPSIS
    Genera e valida gli asset icona usati da Electron e dall'installer NSIS.
.DESCRIPTION
    Usa assets/icon.png come sorgente raster canonica. Sincronizza le copie pubbliche
    e crea assets/icon.ico con frame PNG 16, 32, 48, 64, 128 e 256 px senza dipendenze esterne.
.PARAMETER Check
    Non scrive file: verifica dimensioni, copie pubbliche e frame dell'ICO esistente.
#>

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = "Low")]
param([switch]$Check)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-FileHashValue {
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

function Get-IcoSizes {
    param([Parameter(Mandatory)][string]$Path)

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 6 -or [BitConverter]::ToUInt16($bytes, 0) -ne 0 -or [BitConverter]::ToUInt16($bytes, 2) -ne 1) {
        throw "ICO non valido: $Path"
    }
    $count = [BitConverter]::ToUInt16($bytes, 4)
    if ($bytes.Length -lt 6 + (16 * $count)) { throw "Directory ICO troncata: $Path" }

    $sizes = @()
    for ($index = 0; $index -lt $count; $index++) {
        $offset = 6 + (16 * $index)
        $width = if ($bytes[$offset] -eq 0) { 256 } else { [int]$bytes[$offset] }
        $height = if ($bytes[$offset + 1] -eq 0) { 256 } else { [int]$bytes[$offset + 1] }
        if ($width -ne $height) { throw "Frame ICO non quadrato: ${width}x${height}" }
        $sizes += $width
    }
    return @($sizes)
}

function New-ResizedPngBytes {
    param(
        [Parameter(Mandatory)][System.Drawing.Image]$Source,
        [Parameter(Mandatory)][int]$Size
    )

    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.DrawImage($Source, 0, 0, $Size, $Size)
        } finally {
            $graphics.Dispose()
        }

        $stream = [System.IO.MemoryStream]::new()
        try {
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            return $stream.ToArray()
        } finally {
            $stream.Dispose()
        }
    } finally {
        $bitmap.Dispose()
    }
}

function New-IcoBytes {
    param(
        [Parameter(Mandatory)][System.Drawing.Image]$Source,
        [Parameter(Mandatory)][int[]]$Sizes
    )

    $frames = [System.Collections.Generic.List[byte[]]]::new()
    foreach ($size in $Sizes) {
        $frames.Add((New-ResizedPngBytes -Source $Source -Size $size))
    }
    $stream = [System.IO.MemoryStream]::new()
    $writer = [System.IO.BinaryWriter]::new($stream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$frames.Count)
        $dataOffset = 6 + (16 * $frames.Count)

        for ($index = 0; $index -lt $frames.Count; $index++) {
            $size = $Sizes[$index]
            $frame = [byte[]]$frames[$index]
            $encodedSize = if ($size -eq 256) { 0 } else { $size }
            $writer.Write([byte]$encodedSize)
            $writer.Write([byte]$encodedSize)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]32)
            $writer.Write([uint32]$frame.Length)
            $writer.Write([uint32]$dataOffset)
            $dataOffset += $frame.Length
        }
        foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
        $writer.Flush()
        return $stream.ToArray()
    } finally {
        $writer.Dispose()
        $stream.Dispose()
    }
}

function Write-AtomicBytes {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][byte[]]$Bytes
    )

    $directory = Split-Path -Parent $Path
    $temporaryPath = Join-Path $directory (".{0}.{1}.tmp" -f [System.IO.Path]::GetFileName($Path), [Guid]::NewGuid().ToString("N"))
    try {
        [System.IO.File]::WriteAllBytes($temporaryPath, $Bytes)
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
    }
}

try {
    $rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    $sourcePng = Join-Path $rootDir "assets\icon.png"
    $sourceSvg = Join-Path $rootDir "assets\onlyrag-icon.svg"
    $iconIco = Join-Path $rootDir "assets\icon.ico"
    $publicPng = Join-Path $rootDir "public\icon.png"
    $publicSvg = Join-Path $rootDir "public\onlyrag-icon.svg"
    $requiredSizes = @(16, 32, 48, 64, 128, 256)

    foreach ($source in @($sourcePng, $sourceSvg)) {
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Asset sorgente mancante: $source" }
    }

    Add-Type -AssemblyName System.Drawing
    $image = [System.Drawing.Image]::FromFile($sourcePng)
    try {
        if ($image.Width -ne $image.Height -or $image.Width -lt 256) {
            throw "assets/icon.png deve essere quadrato e almeno 256 px; rilevato $($image.Width)x$($image.Height)."
        }

        $svgText = [System.IO.File]::ReadAllText($sourceSvg)
        if ($svgText -notmatch "<svg\b" -or $svgText -notmatch "viewBox\s*=") {
            throw "assets/onlyrag-icon.svg non contiene un elemento SVG con viewBox."
        }

        if ($Check) {
            foreach ($pair in @(@($sourcePng, $publicPng), @($sourceSvg, $publicSvg))) {
                if (-not (Test-Path -LiteralPath $pair[1] -PathType Leaf)) { throw "Copia pubblica mancante: $($pair[1])" }
                if ((Get-FileHashValue $pair[0]) -ne (Get-FileHashValue $pair[1])) {
                    throw "Asset pubblico non sincronizzato: $($pair[1])"
                }
            }
            if (-not (Test-Path -LiteralPath $iconIco -PathType Leaf)) { throw "ICO installer mancante: $iconIco" }
            $actualSizes = @(Get-IcoSizes -Path $iconIco)
            if (($actualSizes -join ",") -ne ($requiredSizes -join ",")) {
                throw "Frame ICO inattesi: $($actualSizes -join ', '); richiesti: $($requiredSizes -join ', ')."
            }
            Write-Host "[PASS] Asset validi e sincronizzati (PNG $($image.Width)x$($image.Height), ICO: $($requiredSizes -join ', '))." -ForegroundColor Green
            exit 0
        }

        if ($PSCmdlet.ShouldProcess($iconIco, "Generate multi-resolution installer icon")) {
            Write-AtomicBytes -Path $iconIco -Bytes (New-IcoBytes -Source $image -Sizes $requiredSizes)
        }
        if ($PSCmdlet.ShouldProcess($publicPng, "Synchronize public PNG icon")) {
            Write-AtomicBytes -Path $publicPng -Bytes ([System.IO.File]::ReadAllBytes($sourcePng))
        }
        if ($PSCmdlet.ShouldProcess($publicSvg, "Synchronize public SVG icon")) {
            Write-AtomicBytes -Path $publicSvg -Bytes ([System.IO.File]::ReadAllBytes($sourceSvg))
        }
    } finally {
        $image.Dispose()
    }

    & $PSCommandPath -Check
    if ($LASTEXITCODE -ne 0) { throw "Validazione degli asset generati fallita." }
    exit 0
} catch {
    Write-Host "[FATAL ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
