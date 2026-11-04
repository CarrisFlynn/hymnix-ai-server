param(
    [string]$Version = "1.0.0.0",
    [string]$CertificatePath = "",
    [string]$CertificatePassword = "",
    [string]$Output = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $root "dist\msix-stage"
$outDir = if ($Output) { $Output } else { Join-Path $root "dist" }
$msixName = "Hymnix-AI-Server_$($Version)_x64.msix"

function Find-MakeAppx {
    $sdkRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    $candidates = @()
    if (Test-Path $sdkRoot) {
        $candidates += Get-ChildItem $sdkRoot -Directory | Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName "x64\makeappx.exe" }
    }
    $g = (Get-Command makeappx.exe -ErrorAction SilentlyContinue).Source
    if ($g) { $candidates += $g }
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    throw "makeappx.exe not found. Install the Windows SDK (10) first."
}

function Find-SignTool {
    $sdkRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    if (Test-Path $sdkRoot) {
        $c = Get-ChildItem $sdkRoot -Directory | Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } | Select-Object -First 1
        if ($c -and (Test-Path $c)) { return $c }
    }
    $g = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
    if ($g) { return $g }
    return $null
}

$serverExe = Join-Path $root "dist\Hymnix-AI-Server.exe"
if (!(Test-Path $serverExe)) {
    Write-Host "Server exe not found, running build.ps1 -ServerOnly" -ForegroundColor Yellow
    & (Join-Path $root "build.ps1") -ServerOnly
}

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage | Out-Null
New-Item -ItemType Directory (Join-Path $stage "Assets") | Out-Null
Copy-Item $serverExe $stage
Copy-Item (Join-Path $root "msix\Assets\*") (Join-Path $stage "Assets") -Force
Copy-Item (Join-Path $root "msix\AppxManifest.xml") $stage -Force
Copy-Item (Join-Path $root "LICENSE"), (Join-Path $root "README.md") $stage -Force

New-Item -ItemType Directory $outDir -Force | Out-Null
$makeappx = Find-MakeAppx
$out = Join-Path $outDir $msixName
Write-Host "Packing $out" -ForegroundColor Cyan
& $makeappx pack /d $stage /p $out /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed" }

if ($CertificatePath) {
    $signtool = Find-SignTool
    if (-not $signtool) { throw "signtool.exe not found. Install the Windows SDK." }
    Write-Host "Signing $out" -ForegroundColor Cyan
    & $signtool sign /fd SHA256 /f $CertificatePath /p $CertificatePassword $out
    if ($LASTEXITCODE -ne 0) { throw "signtool failed" }
}

Write-Host "Done: $out" -ForegroundColor Green
Write-Host "Local test: import the certificate into 'Trusted People', then Add-AppxPackage '$out'"
