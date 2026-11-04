# Architecture

## Overview

Hymnix has two executables that talk over an HTTP API.

```
Hymnix-Client.exe  --HTTPS (tunnel)-->  Hymnix-AI-Server.exe  --HTTP-->  Ollama
```

- **Hymnix-AI-Server.exe** contains the desktop console and the gateway.
- **Hymnix-Client.exe** is a small chat client for invited users. It can also be pointed at any OpenAI-compatible endpoint.

## Server components

| File | Responsibility |
|---|---|
| server/hymnix_main.py | Tkinter console: UI, model manager, tunnel control, monitor tab |
| server/gateway_core.py | HTTP server, authentication, routing, adapters, logging, metrics |
| server/dashboard.html | Admin dashboard served at /admin |
| server/assets/ | Icons, splash image, UI sound files |

## Request flow

1. Client sends POST /v1/chat/completions with a Bearer key.
2. Gateway authenticates the key (master or admin).
3. Compatibility layer inspects the client profile (User-Agent, tools, path) and decides a mode:
   - openai: forward tools and return standard tool_calls
   - text_tools: strip tool definitions, instruct the model to emit JSON in the reply
   - plain: ignore tools
   - json_only: force non-streaming
4. Messages are trimmed against the character budget; system prompts are always preserved.
5. The request is forwarded to Ollama (/api/chat) with model aliasing and keep_alive.
6. The reply is converted back to OpenAI shape (tool_calls, usage) when needed.
7. The conversation is appended to logs/conversations-YYYYMMDD.jsonl; the monitor reads it back.

## Concurrency and resources

- The HTTP server is threaded (one thread per connection).
- Requests from the same client IP are serialised, so one agent cannot thrash the GPU.
- A background thread unloads the model after idle_unload_seconds of inactivity.
- GPU metrics are sampled with nvidia-smi before and after each request; energy is estimated as power x duration.

## Storage

All mutable data lives in %LOCALAPPDATA%\Hymnix\:

```
gateway_config.json     configuration and keys
huimeng_config.json     console settings (name, model, UI options)
logs/
  conversations-*.jsonl full request/response records
  events-*.jsonl        lifecycle and admin events
tunnel_url.txt          last tunnel address
bin/cloudflared.exe     downloaded tunnel helper
```

## Security model

- The gateway listens on 127.0.0.1 only.
- api_key is required for model endpoints; admin_key is required for /admin/*.
- No telemetry, no outbound calls except to Ollama, the tunnel provider, and (once) GitHub for cloudflared.
