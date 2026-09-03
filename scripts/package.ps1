# ====================================================================
#  KnowLink Knowledge Galaxy - local packaging script (Windows PowerShell)
#  Usage:
#    powershell -ExecutionPolicy Bypass -File scripts/package.ps1
#    powershell -ExecutionPolicy Bypass -File scripts/package.ps1 -Version 2.0
#  Output: dist/knowlink-view-<version>.zip (unzip and load in Chrome)
# ====================================================================

param(
    [string]$Version = "2.0"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Stage = Join-Path $Root "dist\knowlink-view-$Version"
$Zip = Join-Path $Root "dist\knowlink-view-$Version.zip"

# Files/dirs required by the extension at runtime
$Include = @(
    "manifest.json",
    "background.js",
    "content.js",
    "sidepanel.html",
    "network.html",
    "pdf-viewer.html",
    "css",
    "js",
    "lib",
    "LICENSE"
)

Write-Host "==> Packaging KnowLink Knowledge Galaxy v$Version" -ForegroundColor Cyan

# Clean previous artifacts
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
if (Test-Path $Zip) { Remove-Item -Force $Zip }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

# Copy extension files
foreach ($item in $Include) {
    $src = Join-Path $Root $item
    if (-not (Test-Path $src)) {
        Write-Warning "Skipping missing file: $item"
        continue
    }
    Copy-Item -Recurse -Force $src (Join-Path $Stage $item)
}

# Exclude user config that may contain an API key (copied from ai-config.example.js)
$aiConfig = Join-Path $Stage "js\core\ai-config.js"
if (Test-Path $aiConfig) {
    Remove-Item -Force $aiConfig
    Write-Host "==> Excluded js/core/ai-config.js (may contain API key)" -ForegroundColor Yellow
}

# Compress
Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $Zip -Force
Remove-Item -Recurse -Force $Stage

$size = [math]::Round((Get-Item $Zip).Length / 1KB, 1)
Write-Host "==> Done: $Zip ($size KB)" -ForegroundColor Green
Write-Host "    Unzip it, then chrome://extensions/ -> Developer mode -> Load unpacked" -ForegroundColor DarkGray