# Privacy Policy

Hymnix AI Server is a **local-first** application. It contains no telemetry, analytics, or crash reporting.

## What is stored, and where

| Data | Location | Purpose |
|---|---|---|
| App configuration (including API keys) | %LOCALAPPDATA%\Hymnix\ | Reconnect after restart |
| Conversation logs | %LOCALAPPDATA%\Hymnix\logs\ | Host reviews requests (by design) |
| Tunnel URL | %LOCALAPPDATA%\Hymnix\tunnel_url.txt | Show current public address |
| Downloaded tunnel helper | %LOCALAPPDATA%\Hymnix\bin\ | Optional public access |

Nothing is uploaded to the author. The only outbound traffic is:

1. Ollama at 127.0.0.1:11434 (local)
2. Cloudflare / ngrok, only when you explicitly start a tunnel
3. GitHub (optional, once) when the app downloads cloudflared.exe on first tunnel use

## Logs and other people's data

If you invite others to your server, their prompts and replies are stored on YOUR computer. You are responsible for that data. Use the built-in filtered cleanup, which archives before deleting.

## Removing your data

Delete %LOCALAPPDATA%\Hymnix\ and uninstall the app.

## Contact

Open an issue in the GitHub repository.
