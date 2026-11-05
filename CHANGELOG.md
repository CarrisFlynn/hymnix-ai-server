# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Chinese / English interface switch, auto-detected from the system language
  (Settings > Language / 语言; restart to apply)
- Free model selection: the server no longer forces a default model. The client
  chooses any installed Ollama model, and the settings panel can refresh the list
  from the server
- Optional `default_model` and `model_aliases` configuration for advanced setups
- On-demand public tunnel with an explicit Start / Stop button and status indicator
- Per-request metrics in the server console: latency, tokens, GPU utilisation,
  VRAM, power draw and estimated energy cost

### Changed

- Buttons and labels are aligned consistently; leading icons no longer shift text
- Request history is presented as a troubleshooting view, with a short note that
  invited users should know their requests are processed on the host
- Log cleanup is filtered (by date, source IP, keyword) and archives records
  before removing them
- Documentation rewritten and kept in both English and Chinese

### Fixed

- System prompts are preserved when long conversations are trimmed
- Requests from the same client are serialised, preventing VRAM thrashing
- Idle model unloading now respects tool-using agents (configurable keep-alive)
- `/v1` responses report the real model that produced the completion
- Client compatibility modes no longer send conflicting tool instructions

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
- Faster cold start (about 2.0 s → 0.7 s).

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
