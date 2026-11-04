# Setup Guide

## 1. Prerequisites

| Item | Notes |
|---|---|
| Windows 10/11 | The prebuilt exe targets Windows x64 |
| [Ollama](https://ollama.com/download) | Local model runtime |
| 8 GB RAM / 8 GB VRAM | Enough for `qwen3:8b` @ 16K context; less is fine with smaller models |
| cloudflared.exe | **Only if you want the public tunnel.** Download from Cloudflare and put it next to the server exe |

## 2. Install a model

```powershell
ollama pull qwen3:8b
```

Check it runs:

```powershell
ollama run qwen3:8b "hello"
```

## 3. Run the server

### Option A — prebuilt exe

1. Download `Hymnix-AI-Server.exe` from Releases.
2. Put it in an empty folder (it writes config/logs there).
3. Double-click. First run generates `gateway_config.json` with random keys.
4. Wait for **Gateway / Model** dots to turn green.

### Option B — from source

```powershell
git clone https://github.com/<your-account>/hymnix-local-ai-server.git
cd hymnix-local-ai-server
pip install pyinstaller
.\build.ps1
```

## 4. Public access (optional)

1. Put `cloudflared.exe` next to the server exe (Windows build from Cloudflare).
2. In the app status bar click **Start Tunnel**.
3. When the address appears, click **Copy** — it copies URL + API key.
4. Send both to the person you're inviting.

> The tunnel is intentionally manual: each new one allocates a public hostname, so automatic creation on startup would be wasteful and may be rate-limited.

## 5. LAN-only mode

Skip the tunnel. Others on the same network can use:

```
http://<your-LAN-IP>:11435/v1   e.g. http://192.168.1.20:11435/v1
```

Windows Firewall may ask to allow Python/exe on private networks — allow it.

## 6. Change ports / keys

Edit `gateway_config.json` next to the exe:

| Key | Meaning |
|---|---|
| `listen_port` | Gateway port, default 11435 |
| `api_key` | Key friends must send |
| `admin_key` | Key for the admin/monitor endpoints — never share |
| `model_aliases` | Map client model names to real Ollama models |
| `compat_mode` | `auto` / `openai` / `text_tools` / `plain` / `json_only` |
| `idle_unload_seconds` | Unload model from VRAM after N idle seconds (default 60) |
| `keep_alive_agent` | Keep-alive for tool-using agents (default 300) |

Restart the app after editing.

## 7. Verify

```powershell
curl http://127.0.0.1:11435/health
# {"ok": true, "gateway": "1.0.0", "ollama": true, ...}

curl http://127.0.0.1:11435/v1/chat/completions ^
  -H "Authorization: Bearer YOUR_API_KEY" ^
  -H "Content-Type: application/json" ^
  -d "{\"model\":\"qwen3:8b\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"
```
