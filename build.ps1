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
    $args = @(
        "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--windowed",
        "--name", "Hymnix-AI-Server", "--icon", "assets/icon.ico", "--splash", "assets/splash.png",
        "--add-data", "dashboard.html;.", "--add-data", "assets/icon.ico;.",
        "--add-data", "assets/icon.png;.", "--add-data", "assets/key1.wav;.",
        "--add-data", "assets/key2.wav;.", "--add-data", "assets/key3.wav;.",
        "--hidden-import", "gateway_core", "--paths", ".", "hymnix_main.py"
    )
    & $python @args
    Pop-Location
    New-Item -ItemType Directory "$root\dist" -Force | Out-Null
    Copy-Item "$root\server\dist\Hymnix-AI-Server.exe" "$root\dist\" -Force
}

function Build-Client {
    Write-Host "==> Building Hymnix Client" -ForegroundColor Cyan
    Push-Location "$root\client"
    $args = @(
        "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--windowed",
        "--name", "Hymnix-Client", "--icon", "assets/icon.ico",
        "--add-data", "assets/icon.ico;.", "hymnix_client_app.py"
    )
    & $python @args
    Pop-Location
    New-Item -ItemType Directory "$root\dist" -Force | Out-Null
    Copy-Item "$root\client\dist\Hymnix-Client.exe" "$root\dist\" -Force
}

if (-not $ClientOnly) { Build-Server }
if (-not $ServerOnly) { Build-Client }

Write-Host "Done. Executables are in $root\dist" -ForegroundColor Green
