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

- **550C terminal console** - the terminal tab is now a full mission-control style
  console: header with live clock and signal waveform, LINK / TUN / PROC status
  chips, SYS.LOG stream with timestamp and level colouring, telemetry bar and a
  real command line with history, tab completion and danger confirmation.
- **19 terminal commands** - `help`, `status`, `version`, `models`, `model <name>`,
  `sharemodel <name>`, `config get|set`, `path`, `tunnel on|off|restart|status`,
  `quota <n>`, `billing on|off`, `lang <code>`, `service start|stop|restart`,
  `hardware`, `export [file]`, `history`, `clear`, plus any Windows command.
  Full reference in `docs/terminal-commands.md` and `help` inside the app.
- **Tunnel details inside the terminal tab** - status, public URL, copy / open
  buttons, QR code for phones, cloudflared / ngrok engine switch, custom ngrok
  domain and the last five tunnel log lines, all collapsible.
- **One-click updates** - checks the GitHub release, shows release notes,
  downloads with a progress bar, verifies SHA-256, then swaps the executable and
  restarts (DevSidecar-style, never overwrites a running binary).
- **Five-language interface** - 简体中文, English, Français, Русский, Español, with a
  language grid on the welcome screen and a language command in the terminal.
- **Screen-aware window sizing** - the window scales with the monitor DPI and is
  clamped to the usable desktop area, so it no longer opens off-screen.
  Per-Monitor V2 manifest keeps text crisp at 125% / 150% / 200% scaling.
- **Public edition layout** - 1.1.0 numbering everywhere, AGPL-3.0 licence text,
  `source/`, `docs/`, `locales/` folders and a printable `说明.txt`.

### Changed

- Flat visual system: design tokens (radius 8 / 12 / 16, spacing 4 / 8), Microsoft
  YaHei UI for small Chinese text, no more 仿宋 fallback.
- Page transitions: 280 ms ease-out cubic with a 24 px offset, while the first
  paint of a page skips the animation so nothing jumps on entry.
- The terminal streams real shell output, keeps a command history file and limits
  the buffer to 500 lines.
- Startup time 2.0 s → 0.7 s by skipping the reverse-DNS lookup the HTTP server
  used to perform on bind.
- Sidebar: brand icon, group headings and a three-line status block with state
  dots replace the old text labels.

### Fixed

- Plugins and sponsor pages no longer reflow on first paint (layout jump removed).
- Terminal output is clipped inside its own tab instead of overflowing the window.
- Version strings unified; the internal development codename no longer appears in
  the public build.
- The window no longer opens maximised by default.

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
