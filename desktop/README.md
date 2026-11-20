# Hymnix Desktop shell (task-4)

Windows-first Electron + React foundation for migrating the existing Python application without changing or deleting Python capabilities. The renderer communicates through a strict preload bridge and the gateway uses `http://127.0.0.1:11435`.

## Commands
From this directory only: `npm install`, `npm run typecheck`, `npm test`, `npm run build`.

The gateway contract is `GET /health`, `GET /api/tags`, and `POST /v1/chat/completions` with SSE. The renderer passes the API key through the preload bridge for each request; the key is held in memory and is not persisted.

## Experimental terminal reply bridge

See the [terminal bridge guide](docs/terminal-bridge.zh-CN.md) for commands, the loopback protocol and a Windows adapter example.

## Migration gaps
Tool orchestration, rich canvas actions, session persistence, and gateway configuration UI are intentionally labeled migration gaps. No Python capability is removed. The current base URL is a safe local default and should become managed configuration once the migration contract is finalized.
