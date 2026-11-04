param(
    [switch]$ServerOnly,
    [switch]$ClientOnly,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = "python"

if ($Clean) {
    Remove-Item "$root\dist" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$root\build" -Recurse -Force -ErrorAction SilentlyContinue
}

function Build-Server {
    Write-Host "==> Building Hymnix AI Server" -ForegroundColor Cyan
    Push-Location "$root\server"
    & $python -m PyInstaller --noconfirm --clean --onefile --windowed `
        --name "Hymnix-AI-Server" --icon "icon.ico" --splash "splash.png" `
        --add-data "dashboard.html;." --add-data "icon.ico;." --add-data "icon.png;." `
        --add-data "key1.wav;." --add-data "key2.wav;." --add-data "key3.wav;." `
        --hidden-import gateway_core --paths "." "hymnix_main.py"
    Pop-Location
    Copy-Item "$root\server\dist\Hymnix-AI-Server.exe" "$root\dist\" -Force -ErrorAction SilentlyContinue
}

function Build-Client {
    Write-Host "==> Building Hymnix Client" -ForegroundColor Cyan
    Push-Location "$root\client"
    & $python -m PyInstaller --noconfirm --clean --onefile --windowed `
        --name "Hymnix-Client" --icon "icon.ico" --add-data "icon.ico;." `
        "hymnix_client_app.py"
    Pop-Location
    if (!(Test-Path "$root\dist")) { New-Item -ItemType Directory "$root\dist" | Out-Null }
    Copy-Item "$root\client\dist\Hymnix-Client.exe" "$root\dist\" -Force -ErrorAction SilentlyContinue
}

if (-not $ClientOnly) { Build-Server }
if (-not $ServerOnly) { Build-Client }

Write-Host "Done. Executables are in $root\dist" -ForegroundColor Green
