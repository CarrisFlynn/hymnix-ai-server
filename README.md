# Hymnix Local AI Server

Run a private AI gateway on your own computer, expose it through a tunnel, and let your friends' apps use your local model — while you keep a live view of every request.

- 🖥 **Local-first**: models run on your machine via [Ollama](https://ollama.com). No cloud account required.
- 🔐 **Key-based access**: every request needs an API key you control.
- 🌍 **Shareable**: built-in Cloudflare Tunnel (default) or ngrok support gives friends a public HTTPS endpoint.
- 📊 **Live console**: terminal trace, request monitor, per-request GPU / energy / latency metrics.
- 🧰 **OpenAI-compatible**: `POST /v1/chat/completions`, including tool calling — works with any OpenAI-style client.
- 🤖 **Client included**: a ready-to-use desktop client for the people you invite.
- 🔌 **AI interface**: the client can point at this server or at any other OpenAI-compatible endpoint.

## Quick start (5 minutes)

### 1. Install Ollama and pull a model

```powershell
winget install Ollama.Ollama
ollama pull qwen3:8b
```

> 8 GB VRAM is enough for `qwen3:8b` at 16K context. Any Ollama model works; smaller models are faster.

### 2. Start the server

- **Windows (recommended)**: download the latest `Hymnix-AI-Server.exe` from the *Releases* page and double-click it.
- **From source**:
  ```powershell
  pip install pyinstaller
  .\build.ps1
  ```

The server listens on `127.0.0.1:11435` and writes its config, keys and logs next to the executable.

### 3. Start the tunnel and share

1. Click **Start Tunnel** (启动隧道) in the app's status bar.
2. Wait for the public address to appear, then click **Copy** — it copies the URL **and** the API key.
3. Send that to your friend.

The tunnel is **on-demand on purpose**: every new tunnel costs a public hostname, so the app does not create one on startup.

### 4. Friend side

Send them `Hymnix-Client.exe` (Releases) plus the URL and key. In the client: **Settings → AI interface**, fill in:

| Field | Value |
|---|---|
| Endpoint | `https://<your-tunnel>/v1` |
| API key | the key copied from the server |
| Model | `qwen3:8b` (or any model you pulled) |

Then chat. Requests show up on your server console in real time.

## Repository layout

```
server/    Desktop server (gateway + tunnel + monitor), Tkinter
client/    Desktop client for invited users
config/    Example configuration files
examples/  curl / Python / Node API examples
docs/      Setup, client, security and FAQ guides
build.ps1  One-click build for both executables
```

## How it works

```
Friend's client ──HTTPS──> Cloudflare tunnel
                              │
                        Hymnix gateway (127.0.0.1:11435)
                              │
                         Ollama (127.0.0.1:11434)
```

The gateway exposes an OpenAI-compatible API, forwards requests to Ollama, and records a per-request trace (prompt, tools, reply, tokens, GPU usage, energy). The tunel is optional — on a LAN you can connect directly to `http://<host>:11435`.

## API (OpenAI-compatible)

```bash
curl https://YOUR-TUNNEL/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3:8b","messages":[{"role":"user","content":"Hello"}]}'
```

Also available: `GET /health`, `GET /api/tags`, `POST /api/chat` (Ollama native), `POST /api/generate`, and admin endpoints protected by a separate admin key.


> **Where data lives:** configs, keys, logs and the downloaded tunnel helper are stored in `%LOCALAPPDATA%\Hymnix\` (required for Store packaging). Delete that folder to remove all app data.

## Security

- The gateway binds to localhost only; friends reach it through the tunnel.
- API keys and admin keys are generated on first run and stored in `gateway_config.json`.
- **Never commit `gateway_config.json`, `huimeng_config.json`, `logs/` or `tunnel_url.txt`.**
- Logs contain full conversations. Treat them as private data and clean them with the built-in filtered cleanup.

See [docs/SECURITY.md](docs/SECURITY.md) for details.

## License

AGPL-3.0. See [LICENSE](LICENSE).

If you modify and deploy this software as a network service, the AGPL requires you to publish your modified source.
