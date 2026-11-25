# Architecture

## Overview

Hymnix Orbit 1.3.3 is one application with three processes:

```
Electron renderer (React, app://hymnix)  <--IPC-->  Electron main  <--HTTP loopback-->  headless gateway  -->  Ollama / cloud provider
```

- **Renderer** — `desktop/src/renderer`. React + TypeScript, built by Vite into `dist/renderer` and loaded over the privileged `app://` protocol (not `file://`, so ES modules and CSP behave normally). It has no Node access.
- **Main** — `desktop/src/main`. Owns the window, the gateway lifecycle, credentials, files, the terminal, provider adapters and every outbound request.
- **Gateway** — `server/headless_gateway.py` (packaged as `backend-gateway-headless.exe`) running `server/gateway_core.py`. It is supervised by `GatewayLifecycle` and speaks to Ollama at `127.0.0.1:11434`.
- **Console (legacy)** — `server/hymnix_main.py` is the old Tk console. It is not shipped by the installer and is kept for reference and for the extra pages the desktop shell does not expose.

There is no separate client executable any more: the desktop app is both host and guest.

## Process and IPC boundary

| Concern | Owner |
|---|---|
| Window, tray, single-instance lock | main (`desktop/src/main/main.ts`) |
| Gateway spawn, health probe, restart, shutdown | main (`gateway-lifecycle.ts`) |
| Chat streaming, provider dialects (OpenAI, Anthropic, OpenClaw) | main (`providers.ts`), streamed to the renderer as `gateway:delta` events |
| Files, workspace root, terminal | main; the renderer may only ask, never read directly |
| Settings, credential vault, cache path | main; `safeStorage` (DPAPI) for secrets |
| Theme, density, text scale | renderer; the resolved background colour is reported back to main so the next window paints in the right colour |

Every `ipcMain.handle` starts with `assertSender(event)`: only `app://hymnix/index.html` and loopback dev pages may call. The preload (`src/preload/preload.ts`) exposes a typed `window.hymnix` API and nothing else; `contextIsolation`, `sandbox` and `webSecurity` stay on, and `window.open`/navigation are denied.

## Gateway lifecycle

1. On boot the main process starts the bundled headless gateway with a control directory and reads `ready.json` for the port.
2. The renderer polls `gateway:health`, which proxies `GET /health` on the loopback gateway.
3. Restart and stop go through the same `GatewayLifecycle` operation runner, so a restart during a start is queued instead of silently dropped.
4. On quit, `before-quit` aborts chat streams, kills terminal process trees, stops the local reply bridge and shuts the gateway down through its control file.

## Request flow (local chat)

1. Renderer calls `gateway.streamChat({ requestId, baseUrl, model, messages })`.
2. Main picks a path: `kind !== "openai"` or a supplied key goes straight to the provider adapter; otherwise it posts to `http://127.0.0.1:<port>/v1/chat/completions` with the local API key.
3. The gateway checks the key, enforces the daily quota, applies the compatibility layer, forwards to Ollama, and streams SSE back.
4. Main parses SSE, normalises text/reasoning/errors into one delta shape and forwards it with the request id. The renderer only appends deltas that still match the live request id, so cancelling or switching conversations cannot leak text into another session.

Cloud providers (OpenAI-compatible, Anthropic Messages, OpenClaw) are handled entirely in `providers.ts`; the gateway is bypassed.

## Storage

Desktop data (`app.getPath("userData")`):

```
orbit-settings.json      settings, last resolved appearance
orbit-credentials.bin    safeStorage-encrypted secrets (admin key, cloud keys)
Cache/                   configurable download/cache directory
startup.log              boot diagnostics
```

Gateway data (`%LOCALAPPDATA%\Hymnix`, overridable with `HYMNIX_DATA_DIR`):

```
gateway_config.json      keys, share identity, quotas, cloud provider
logs/conversations-*.jsonl, events-*.jsonl, config-*.jsonl
logs/archive/            removed conversation records
tunnel_url.txt           last public tunnel address
```

## Security model

- The desktop gateway binds `127.0.0.1` only; the public tunnel is the only way out and it terminates at the same loopback socket.
- `_dispatch` authenticates every `/admin/*` route before routing, so a new handler cannot be published without the admin key.
- The API key (for guests) is separate from the admin key (for management). Guest keys cannot reach model management verbs such as `/api/pull` or `/api/delete`.
- The share password never leaves the machine in plain text except to a direct loopback caller that already proved the admin key; requests that came through the tunnel are detected via Cloudflare's forwarding headers and excluded.
- CORS is an allowlist (`app://hymnix`, loopback pages). Other origins get no CORS header at all.
- Cloud provider base URLs are validated: `http(s)` only, and link-local addresses (the cloud metadata service) are rejected.
- Plugins run in an exec sandbox with a restricted builtins table, an import allowlist, a dunder-attribute block and a trace-hook deadline that actually interrupts runaway code.
- Conversation cleanup archives records before truncating the originals, and file writes go through a fsynced temp file plus `os.replace`.

## Theme system

Nine presets in `desktop/src/styles/themes/`, one file each, all defining the same semantic tokens (`--bg`, `--surface`, `--text`, `--accent-fill`, `--term-*`, status colours). `renderer/theme-bootstrap.js` runs as a blocking classic script in `<head>` so `data-theme`, density and text scale exist before the first paint, and the main process reuses the last resolved background colour for the window. `tools/check-contrast.mjs` (31 pairs per theme, real `color-mix()` math) and `tools/check-css-tokens.mjs` (no hex, no named colours outside the theme files) gate the build.

## Packaging

`electron-builder` produces an NSIS installer and a portable build from `desktop/dist`, with the backend executable, the Java engine jar and `cloudflared.exe` as extra resources.

## Tests

- `desktop/tests/*.test.mjs` — protocol contract, gateway lifecycle, providers, pull stream, terminal bridge, components (token uniformity, contrast copy, i18n coverage).
- `desktop/tests/visual/pages.spec.ts` — Playwright screenshots of every page in every theme.
- `tools/check-contrast.mjs`, `tools/check-css-tokens.mjs` — design gates run by `pnpm check`.
