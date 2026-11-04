# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- GitHub issue templates, pull request template and CI build workflow
- English documentation; Chinese translations under docs/zh-CN

### Changed
- Model selection is fully client-driven: no forced default model, optional default_model and model_aliases
- Documentation reworded to describe the console as a troubleshooting view, not surveillance
- Repository reorganised into server/, client/, docs/, packaging/, examples/

## [1.0.0] - 2026-11-05

### Added
- Local AI gateway with an OpenAI-compatible API (/v1/chat/completions)
- Ollama passthrough endpoints (/api/chat, /api/tags)
- On-demand Cloudflare Tunnel and ngrok support
- Desktop server console with terminal trace and request monitor
- Per-request metrics: latency, tokens, GPU utilisation, VRAM, power and estimated cost
- Idle model unloading (60 s default) to free VRAM
- Client compatibility modes: auto, openai, text_tools, plain, json_only
- Tool-calling support for OpenAI-style clients
- Desktop client with configurable endpoint, API key and model
- MSIX manifest, Store assets and privacy policy
- Data stored in %LOCALAPPDATA%\Hymnix for Microsoft Store compatibility
- On-demand cloudflared.exe download instead of bundling the binary

### Security
- Random API and admin keys generated on first run
- Admin endpoints protected by a separate key
- Structured error codes for 401, 429 and 5xx responses
