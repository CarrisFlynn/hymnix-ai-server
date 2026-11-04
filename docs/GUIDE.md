# Operation Guide

A step-by-step guide to running Hymnix in daily use. Screenshots are described rather than embedded; every step names the exact button or field.

## 1. First run

1. Install Ollama: `winget install Ollama.Ollama` (or download from ollama.com).
2. Pull a model: `ollama pull qwen3:8b`.
3. Run **Hymnix-AI-Server.exe**.
4. Wait until the status dots turn green: **Gateway**, **Model**.
5. A config folder is created at `%LOCALAPPDATA%\Hymnix\`. Open it with **File -> Open data folder**.

## 2. Start the public tunnel

The tunnel is intentionally manual - each one allocates a public hostname.

1. Click **Start Tunnel** in the status bar.
2. The first time, cloudflared (~55 MB) is downloaded automatically.
3. When the address appears (for example `https://random-words.trycloudflare.com`), click **Copy address**.
4. The clipboard now contains the URL **and** the API key, ready to send to a friend.

To stop sharing, click **Stop Tunnel**. The address stops working immediately.

## 3. Invite a friend

Send them:

1. **Hymnix-Client.exe**
2. the copied text (URL + key)

They open **Settings -> AI interface** and fill:

| Field | Value |
|---|---|
| Endpoint | the copied URL + `/v1` |
| API key | the copied key |
| Model | `qwen3:8b` |

Then **Test connection** -> **Save**.

## 4. Watch requests

Open the **Server monitor** tab.

- Left column: connected clients (IP, request count, last activity).
- Right table: one row per request (time, source, model, latency). Click a row to read the full prompt, thinking, tool calls, reply and energy line.
- Filters: time range, source IP, keyword.

## 5. Clean up logs

Logs contain full conversations. Use the filtered cleanup:

1. **Clean up history...**
2. Choose a date range, an IP and/or a keyword. At least one condition is required.
3. **Preview** shows how many records match.
4. **Run cleanup** archives them to `logs/archive/` and removes them from the list.

Nothing is deleted permanently until you delete the archive folder yourself.

## 6. Switch models

- Sidebar **Model** dropdown lists installed models.
- **Refresh models** rescans Ollama.
- **Download model** opens the shelf (search, size, VRAM requirements).
- **Apply** on the compute bar pins a GPU or forces CPU.

The model unloads from VRAM after 60 seconds of inactivity (configurable via `idle_unload_seconds`).

## 7. Change ports or keys

Edit `%LOCALAPPDATA%\Hymnix\gateway_config.json` and restart:

- `listen_port` - gateway port
- `api_key` - what friends use
- `admin_key` - your monitor/admin key, never share
- `model_aliases` - map model names sent by clients
- `compat_mode` - auto / openai / text_tools / plain / json_only

## 8. Common tasks

| Task | How |
|---|---|
| See who is connected | Server monitor -> left column |
| Check public address | Status bar |
| Stop sharing quickly | Stop Tunnel |
| Free VRAM now | wait 60 s, or restart the app |
| Change UI sounds | Plugins tab -> Interface sounds |
| Open data folder | File -> Open data folder |
