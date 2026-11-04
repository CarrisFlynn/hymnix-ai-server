# Security Notes

## Keys

- `api_key`: required by every model request. Share only with people you trust.
- `admin_key`: unlocks `/admin/*` (monitor, logs, cleanup). **Never share.**
- Keys are generated on first run and stored in `gateway_config.json`.
- Rotate by editing the file and restarting the app.

## Network exposure

- The gateway binds to `127.0.0.1` only.
- The tunnel is the only public entry point and is created on demand.
- By default Cloudflare quick tunnels get a random hostname; use your own domain + a named tunnel for a stable address.

## Logs are sensitive

`logs/conversations-*.jsonl` contains full prompts and replies. That is by design (you are the host), but:

- don't commit `logs/`;
- clean them with the monitor's filtered cleanup (it archives before deleting);
- treat the machine as holding private data.

## Resource safety

- The model is unloaded after `idle_unload_seconds` (default 60s) to save VRAM and power.
- Same-IP requests are serialized to avoid VRAM thrash; a busy client gets HTTP 429 with `code: "busy"`.

## AGPL-3.0

If you run a modified version as a network service, you must offer the modified source to its users.
