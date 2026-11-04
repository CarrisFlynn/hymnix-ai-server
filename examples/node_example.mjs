// Node.js 18+
const BASE = "https://YOUR-TUNNEL-ADDRESS";
const KEY = "YOUR_API_KEY";
const MODEL = "qwen3:8b";

const res = await fetch(BASE + "/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "Hello" }] }),
});
console.log(await res.json());
