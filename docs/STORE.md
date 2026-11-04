# Microsoft Store Readiness (Roadmap)

Publishing to the Microsoft Store is possible, but a few architectural changes are needed first.

## What the Store requires

| Requirement | Current state | Action |
|---|---|---|
| MSIX package | Not yet | Add `build-msix.ps1` (MSIX Packaging Tool / Desktop Bridge), sign with Store certificate |
| No writes next to the exe | Writes configs/logs beside the exe | Move data dir to `%LOCALAPPDATA%\\Hymnix` (must-do) |
| No admin rights | Already no admin | Keep it that way |
| Store account | — | One-time developer account fee (~$19) |
| Privacy policy URL | — | Write one (logs are stored locally for the host) |
| Age rating / listing | — | Screenshots (EN/zh-CN), description, category (Developer tools / Utilities) |
| Third-party binaries | Bundles `cloudflared.exe` (~55 MB) | Either download on first run or ship with license notices |
| AGPL-3.0 | Source available | Store listing must link to source (AGPL compatible) |
| Auto-update | — | Store handles updates once MSIX is used |

## Known Store review risks

- **Networking / tunneling**: the app opens a tunnel to expose a local server. That is a legitimate developer tool, but reviewers may ask for a clear purpose statement. Describe it as "local AI server with optional public tunnel for invited users".
- **Bundled tunnel binary**: `cloudflared.exe` is a third-party binary. Include its license text or download it at runtime from the official source.
- **Data location**: Store apps must keep user data under the package's local state; the current "write next to exe" behavior will be blocked in an installed package.

## Recommended order

1. Finish the GitHub release (done — see repo root).
2. Refactor data directory to `%LOCALAPPDATA%\\Hymnix`.
3. Add `docs/PRIVACY.md` (what is stored, where, and that it never leaves the machine).
4. Add MSIX build script + manifest (identity, capabilities: `internetClient` only).
5. Submit via Partner Center.
