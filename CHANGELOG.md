# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [1.2.1] - 2026-11-15

### Fixed

- **Client replies displayed as mojibake**: responses without a `charset` (notably `text/event-stream`) were decoded as ISO-8859-1. The client now forces UTF-8 for JSON and streamed replies, and every server-side `subprocess` call decodes output as UTF-8 with `errors="replace"`.
- **Sidebar opening the wrong page**: the navigation list was missing the Models entry, shifting every page after it by one. Navigation is now keyed by page id instead of position, so a label can never open another page.
- **Missing window and taskbar icon**: icon lookup now falls back to `assets/icon.ico` for both source runs and packaged builds.
- **Oversized terminal typography**: removed a duplicated font scaling factor that multiplied every size a second time on high-DPI displays, and restored the compact 1.2.0 console metrics and toolbar layout.
- **Truncated chat history**: history now streams the whole file, keeps chronological order, and supports search plus JSON/Markdown export.
- **Lost tool and reply trails**: terminal traces are persisted and de-duplicated across restarts.
- **Updater race on channel switch**: a download started for one channel can no longer be applied after the channel changes; every package is verified before install.
- **Split data directory**: server data now resolves through a single data root instead of drifting between the bundle and the user profile.

### Added

- Terminal themes (neon / matrix / amber) with ANSI SGR rendering and per-level log filtering.
- ARM64-aware build matrix with per-architecture guards and automatic `cloudflared` acquisition.
- Approval-gated tool execution with grant validation, trusted plugin installation and plugin provenance.
- Request metrics, batch rollback and resilient downloads in the usage and update views.
- Full five-language coverage across the nine redesigned pages.

### Changed

- Packaging artefacts are versioned and architecture-tagged: `hymnix-client-1.2.1-x64.exe`, `hymnix-server-1.2.1-x64.exe`.

## [1.2.0] - 2026-11-06

### Added

- OCR integration with local engine availability detection, plus file-tree browsing, repository search, and hunk-based diff preview, apply, and rollback.
- A plugin kernel with manifests, permission allowlists, package validation, lifecycle controls, and bounded execution.
- Built-in tools with schema validation, safer filesystem boundaries, and MCP stdio/HTTP transports.
- Multi-session history, context compression, conversation search, and backup-before-delete behavior.
- Approval workflows for sensitive commands, tools, and plugin actions.
- Usage views for tokens, latency, hardware signals, and estimated cost, with cloud usage reconciliation.
- Git proxy configuration, update channels, and release-preparation workflows.
- Improved chat cards, terminal console, and long-list rendering.

### Changed

- Expanded the desktop workflow with dedicated pages for files, diffs, OCR, tools, approvals, usage, and session history.
- Added upstream error normalization and clearer offline behavior for optional cloud integrations.
- Strengthened tool and repository access boundaries, network checks, and plugin package handling.
- Full English coverage across every page, dialog and status line; all screenshots and docs are English-first with a Chinese mirror.

### Fixed

- Preserved system instructions while compressing long contexts.
- Prevented unsafe or undeclared tool arguments and blocked private-network/loopback destinations in guarded tool requests.
- Improved session cleanup safety by backing up data before deletion.

## [1.1.0] - 2026-11-05

### Added

- **Terminal console** - a dark, dashboard-style terminal tab: live clock, signal
  waveform, LINK / TUN / PROC status chips, a colour-coded log stream, a telemetry
  bar and a working command line with history, tab completion and a confirmation
  step for destructive operations.
- **19 terminal commands** - `help`, `status`, `version`, `models`, `model <name>`,
  `sharemodel <name>`, `config get|set`, `path`, `tunnel on|off|restart|status`,
  `quota <n>`, `billing on|off`, `lang <code>`, `service start|stop|restart`,
  `hardware`, `export [file]`, `history`, `logtail`, `clear`, `ps`.
  Full reference in `docs/terminal-commands.md` and `help` inside the app.
- **Tunnel details in the terminal tab** - status, public URL, copy / open
  buttons, QR code for phones, tunnel engine switch, custom ngrok domain and the
  latest tunnel log lines, collapsible.
- **One-click updates** - checks the release, shows the notes, downloads with a
  progress bar, verifies SHA-256 and restarts into the new build without
  overwriting the running executable.
- **Five-language interface** - 简体中文, English, Français, Русский, Español, with a
  language grid on the welcome screen and a language command in the terminal.
- **DPI-aware window** - the window follows the monitor scale and stays inside the
  usable desktop area, with clean text at 125% / 150% / 200%.

### Changed

- Flat visual system: consistent radii and 1 px borders, no raised default controls.
- Page transitions: smooth 280 ms ease-out; the first paint of a page skips the
  animation so nothing jumps on entry.
- Smaller text uses a single UI font family on Windows.
- Sidebar: brand icon, group headings and a three-line status block with state dots.
- Faster cold start (about 2.0 s -> 0.7 s).

### Fixed

- Plugins and sponsor pages no longer reflow on first paint.
- Terminal output stays inside its own tab instead of overflowing the window.
- The window no longer opens maximised by default; the welcome screen keeps its
  buttons visible in every language.
- Update checks pick the server build automatically.

## [1.0.0] - 2026-11-05

### Added

- Local AI gateway with an OpenAI-compatible API (`/v1/chat/completions`)
- Ollama passthrough endpoints (`/api/chat`, `/api/tags`)
- On-demand Cloudflare Tunnel and ngrok support
- Desktop server console with terminal trace and request monitor
- Idle model unloading after 60 seconds (configurable) to free VRAM
- Client compatibility modes: `auto`, `openai`, `text_tools`, `plain`, `json_only`
- Tool-calling support for OpenAI-style clients
- Desktop client with configurable endpoint, API key and model
- Language switch for the client and the server console
- Data stored in `%LOCALAPPDATA%\Hymnix` (Microsoft Store ready)
- On-demand `cloudflared.exe` download instead of bundling the binary
- MSIX manifest, Store assets and a privacy policy

### Security

- Random API and admin keys generated on first run
- Admin endpoints protected by a separate key
- Structured error codes for 401, 429 and 5xx responses

[Unreleased]: https://github.com/CarrisFlynn/hymnix-ai-server/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/CarrisFlynn/hymnix-ai-server/releases/tag/v1.0.0

