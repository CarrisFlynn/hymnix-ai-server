# Microsoft Store Readiness

The project now ships with the pieces needed to build an MSIX package. What has been done and what remains:

## Done

- ✅ Data directory moved to `%LOCALAPPDATA%\Hymnix` (config, logs, tunnel URL, downloaded helpers) — required for Store installs
- ✅ No admin rights needed
- ✅ `cloudflared.exe` is no longer bundled: downloaded on first tunnel start into `%LOCALAPPDATA%\Hymnix\bin`
- ✅ Privacy policy: [PRIVACY.md](PRIVACY.md)
- ✅ MSIX manifest: `msix/AppxManifest.xml` (x64, internetClient + runFullTrust)
- ✅ Store assets: `msix/Assets/` (Square44, Square150, Wide310x150, StoreLogo, Splash)
- ✅ Packaging script: `build-msix.ps1`

## Build an MSIX

```powershell
# 1. Build the server exe
.\build.ps1 -ServerOnly

# 2. Pack (requires Windows SDK 10: makeappx.exe)
.\build-msix.ps1 -Version 1.0.0.0

# 3. (optional) sign with your own certificate for local testing
.\build-msix.ps1 -CertificatePath .\cert.pfx -CertificatePassword YOUR_PASSWORD
```

Output: `dist\Hymnix-AI-Server_1.0.0.0_x64.msix`

## Remaining before submission

| Item | Notes |
|---|---|
| Developer account | Partner Center, one-time fee (~$19) |
| Publisher name | Must match the certificate: currently placeholder `CN=Hymnix Studio` |
| Age rating | Complete the IARC questionnaire (utility / developer tool) |
| Listing assets | Screenshots (1280×800+), description (EN + zh-CN) |
| Review note | Explain that the tunnel is optional and always user-initiated |
| Version bump | `msix/AppxManifest.xml` Version and app title |

## Review risks

- **Tunneling**: reviewers may ask why the app opens a network tunnel. State clearly: *"optional, user-initiated; purpose is to let invited friends reach a local AI server."*
- **Third-party binary download**: cloudflared is fetched from its official GitHub release on first use; the app is functional without it (LAN mode).
- **Network capability**: only `internetClient` + `runFullTrust` are declared.
