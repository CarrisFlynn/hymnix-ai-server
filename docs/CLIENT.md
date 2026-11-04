# Client Guide

`Hymnix-Client.exe` is the desktop app you give to the people you invite.

## Connect to a server

Open **Settings → AI interface** and fill in:

| Field | Example | Notes |
|---|---|---|
| Endpoint | `https://abc-def.trycloudflare.com/v1` | Must end with `/v1` |
| API key | `Hymnix...` | Sent as `Authorization: Bearer` |
| Model | `qwen3:8b` | Any model installed on the server; the list refreshes from it |

Click **Test connection**, then **Save**.

## Use a different AI service

The same three fields accept any OpenAI-compatible endpoint, for example:

- DeepSeek: `https://api.deepseek.com/v1`
- OpenAI: `https://api.openai.com/v1`

Leave "use local server" off if you want a pure cloud setup.

## Settings file

The client stores its config next to the exe as `hymnix_client.json`:

```json
{
  "server_url": "https://your-tunnel/v1",
  "api_key": "YOUR_KEY",
  "model": "qwen3:8b",
  "user_name": "You",
  "ai_name": "Hymnix"
}
```

> `hymnix_client.json` contains your key — never share it or commit it.
