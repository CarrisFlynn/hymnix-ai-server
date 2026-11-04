"""Python 3 example: OpenAI-compatible chat against your Hymnix server."""
import requests

BASE = "https://YOUR-TUNNEL-ADDRESS"      # or http://192.168.1.20:11435 on LAN
KEY = "YOUR_API_KEY"
MODEL = "qwen3:8b"

r = requests.post(
    BASE + "/v1/chat/completions",
    headers={"Authorization": "Bearer " + KEY},
    json={"model": MODEL, "messages": [{"role": "user", "content": "Hello"}]},
    timeout=120,
)
print(r.json()["choices"][0]["message"]["content"])
