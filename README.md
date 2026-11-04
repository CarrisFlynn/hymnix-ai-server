![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey)
![Python](https://img.shields.io/badge/python-3.11%2B-3776AB)

# Hymnix AI Server

**Run a private AI gateway on your own computer, share it with people you trust, and see every request they make.**

Hymnix turns a local [Ollama](https://ollama.com) model into an OpenAI-compatible API, wraps it in a clean Windows desktop app, and optionally exposes it through a public tunnel. A friend can use your GPU from anywhere while you keep a live console of every prompt, tool call and reply.

**Local-first.** No accounts, no cloud, no telemetry. The only traffic that leaves your machine is what you explicitly tunnel to invited users.

---

## Highlights

- **Local models** - anything Ollama can run; 8 GB VRAM is enough for qwen3:8b.
- **OpenAI-compatible API** - /v1/chat/completions, streaming and non-streaming, tool calling included.
- **Live console** - terminal trace, request monitor, latency, tokens, GPU utilisation, VRAM, power and estimated cost per request.
- **Optional public access** - Cloudflare Tunnel (default) or ngrok, started on demand.
- **Desktop client included** - a ready-to-use app for the people you invite; it can also point at any OpenAI-compatible service.
- **Idle-aware** - the model is unloaded from VRAM after 60 seconds of inactivity (configurable).
- **Safe defaults** - gateway binds to localhost, API keys are generated locally, logs stay on the host.

## Quick start

### 1. Install Ollama

```powershell
winget install Ollama.Ollama
ollama pull qwen3:8b
```

### 2. Get the server

**Option A - prebuilt:** download Hymnix-AI-Server.exe from the Releases page.

**Option B - from source:**

```powershell
git clone https://github.com/YOUR-ACCOUNT/hymnix-ai-server.git
cd hymnix-ai-server
pip install -r client/requirements.txt pyinstaller
.\build.ps1
```

### 3. Start it

The server listens on 127.0.0.1:11435. Configuration, keys and logs live in:

```
%LOCALAPPDATA%\Hymnix\
```

On first run a random API key and admin key are generated into gateway_config.json.

### 4. Invite someone

1. In the status bar click **Start Tunnel**.
2. When the address appears, click **Copy** - URL and API key are copied together.
3. Send the client plus that text to your friend.

The tunnel is **manual on purpose**: every new tunnel allocates a public hostname, so creating one at startup wastes quota and may be rate-limited.

### 5. Connect the client

In Hymnix-Client.exe open **Settings -> AI interface**:

| Field | Value |
|---|---|
| Endpoint | https://YOUR-TUNNEL/v1 |
| API key | the key from step 4 |
| Model | qwen3:8b (or any model you pulled) |

## Architecture

```
 Hymnix-Client.exe                      Hymnix-AI-Server.exe
 +--------------+   HTTPS (tunnel)    +---------------------+
 | chat UI      | ------------------> | gateway (11435)     |
 | tools        | <------------------ |  - OpenAI-compatible|
 +--------------+                     |  - compat modes     |
                                      |  - request logging  |
                                      |  - metrics / energy |
                                      +----------+----------+
                                                 | HTTP
                                      +----------v----------+
                                      | Ollama (11434)      |
                                      |  qwen3:8b, ...      |
                                      +---------------------+
```

- The gateway is a standard-library Python HTTP server: no framework, no database.
- Conversations are appended to JSONL files under %LOCALAPPDATA%\Hymnix\logs\.
- compat_mode adapts to different clients: auto, openai, text_tools, plain, json_only.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## API

```bash
curl https://YOUR-TUNNEL/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3:8b","messages":[{"role":"user","content":"Hello"}]}'
```

| Path | Auth | Description |
|---|---|---|
| GET /health | none | Server and model status |
| GET /api/tags | api key | List Ollama models |
| POST /api/chat | api key | Ollama-native chat |
| POST /v1/chat/completions | api key | OpenAI-compatible chat (+ tools, streaming) |
| GET /admin/status | admin key | Clients, stats, recent requests |
| POST /admin/cleanup | admin key | Filtered log cleanup (archives first) |

Examples: [examples/](examples/).

## Configuration

Edit %LOCALAPPDATA%\Hymnix\gateway_config.json and restart:

| Key | Default | Meaning |
|---|---|---|
| listen_port | 11435 | Gateway port |
| api_key / admin_key | generated | Client key / admin key |
| model_aliases | {} | Map client model names to real Ollama models |
| compat_mode | auto | Client compatibility strategy |
| idle_unload_seconds | 60 | Unload model from VRAM after idle |
| keep_alive_agent | 300 | Keep-alive for tool-using agents |
| prompt_char_limit | 26000 | Prompt trimming budget (system prompts always kept) |
| ctx_expand_threshold | 45000 | Auto-expand context when prompt and tools exceed this |

## Security

- The gateway binds to 127.0.0.1; friends reach it only through the tunnel you start.
- Never share admin_key - it unlocks monitoring, logs and cleanup.
- Conversation logs contain full prompts and replies; they are private data.
- See [SECURITY.md](SECURITY.md) and [docs/PRIVACY.md](docs/PRIVACY.md).

## Build from source

```powershell
.\build.ps1               # both executables -> dist/
.\build.ps1 -ServerOnly
.\build.ps1 -ClientOnly
```

Microsoft Store package (MSIX):

```powershell
.\build.ps1 -ServerOnly
.\build-msix.ps1 -Version 1.0.0.0
```

Requires Windows SDK 10 (makeappx.exe). See [docs/STORE.md](docs/STORE.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Install, run, tunnel, LAN mode, ports |
| [docs/CLIENT.md](docs/CLIENT.md) | Client usage and AI endpoint settings |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the gateway works internally |
| [docs/FAQ.md](docs/FAQ.md) | Common problems |
| [docs/STORE.md](docs/STORE.md) | Microsoft Store packaging |
| [docs/PRIVACY.md](docs/PRIVACY.md) | What is stored and where |
| [docs/zh-CN/](docs/zh-CN/) | Chinese translations |


## Support this project

Hymnix is free and open source (AGPL-3.0). If it saves you time, you can support development:

- [爱发电 / Afdian](https://afdian.com/a/YOUR-AFDIAN-NAME) - one-time or monthly support
- Star the repository and share it with someone who runs local models

Paid support, custom builds and deployment help are available on request.

## Contributing

Issues and pull requests are welcome - see [CONTRIBUTING.md](CONTRIBUTING.md). Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) first.


## Contact

- Email: shayhymnix@gmail.com
- X / Twitter: [@ShayHymnix](https://x.com/ShayHymnix)
- Bugs and feature requests: [GitHub Issues](../../issues)

## License

[AGPL-3.0](LICENSE). If you modify Hymnix and run it as a network service, you must offer the modified source to its users.
