# FAQ

**The Start Tunnel button does nothing / stays on "allocating".**
- cloudflared is downloaded on first use; check your network.
- Quick tunnels are rate-limited. Wait a few minutes and retry.
- For a permanent address, use a Cloudflare named tunnel with your own domain.

**My friend cannot connect and the monitor shows no requests.**
The request never reached your machine. Most often the address is stale (tunnels change) or their network blocks the tunnel hostname. Ask them to open https://YOUR-ADDRESS/health in a browser.

**VRAM stays high.**
The model unloads after idle_unload_seconds (default 60). During active conversations it stays loaded, which is expected. Use a smaller model if 8 GB is tight.

**Port 11435 already in use.**
Close the previous instance, or change listen_port in gateway_config.json.

**First reply is slow.**
The model has to load into VRAM. Subsequent replies are faster.

**Does it support tool calling?**
Yes. Requests with tools receive standard tool_calls; text_tools mode also supports clients that parse JSON from the reply body.

**Can I use GPT / DeepSeek / Gemini instead?**
The server itself runs local models. The client's AI interface accepts any OpenAI-compatible endpoint.

**Where is my data?**
%LOCALAPPDATA%\Hymnix. Delete that folder to remove everything.
