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
    & $python -m PyInstaller --noconfirm --clean --distpath "$root\dist" --workpath "$root\build\server" "hymnix-server.spec"
    Pop-Location
}

function Build-Client {
    Write-Host "==> Building Hymnix Client" -ForegroundColor Cyan
    Push-Location "$root\client"
    & $python -m PyInstaller --noconfirm --clean --distpath "$root\dist" --workpath "$root\build\client" "hymnix-client.spec"
    Pop-Location
}

if (-not $ClientOnly) { Build-Server }
if (-not $ServerOnly) { Build-Client }

Write-Host "Done. Executables are in $root\dist" -ForegroundColor Green
