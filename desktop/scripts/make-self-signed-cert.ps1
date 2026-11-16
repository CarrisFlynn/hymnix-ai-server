# Creates a self-signed code-signing certificate for local/test builds only.
# For public releases use a commercial OV/EV certificate, SignPath (free for OSS) or Azure Trusted Signing.
param(
  [string]$OutDir,
  [string]$Password = "HymnixOrbit-Dev-2026"
)
$ErrorActionPreference = "Stop"
if (-not $OutDir) { $OutDir = Join-Path (Split-Path -Parent $PSScriptRoot) "certs" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$pfx = Join-Path $OutDir "hymnix-orbit-selfsigned.pfx"
$cer = Join-Path $OutDir "hymnix-orbit-selfsigned.cer"
$existing = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq "CN=Hymnix Orbit (Self-Signed)" } | Select-Object -First 1
if (-not $existing) {
  $existing = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Hymnix Orbit (Self-Signed)" -KeyUsage DigitalSignature -FriendlyName "Hymnix Orbit dev signing" -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(3)
}
$secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $existing -FilePath $pfx -Password $secure | Out-Null
Export-Certificate -Cert $existing -FilePath $cer | Out-Null
Write-Output ("PFX=" + $pfx)
Write-Output ("CER=" + $cer)
Write-Output ("THUMBPRINT=" + $existing.Thumbprint)
Write-Output ("PASSWORD=" + $Password)
