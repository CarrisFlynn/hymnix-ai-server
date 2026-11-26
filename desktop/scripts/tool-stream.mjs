import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-tools", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen2.5-coder:7b"); } catch { /* ignore */ } });
const result = await win.evaluate(async () => {
  const base = (await window.hymnix.bootstrap()).base;
  const started = Date.now();
  let firstAt = null, text = "", calls = 0, error = null;
  try {
    await window.hymnix.gateway.streamChat({
      requestId: "toolprobe-" + started,
      baseUrl: base, apiKey: "", model: "qwen2.5-coder:7b",
      messages: [{ role: "user", content: "Call the tool echo_now with text hi." }],
      tools: [{ type: "function", function: { name: "echo_now", description: "Echo text back", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } }],
      onDelta: (part) => {
        const choice = part?.choices?.[0] || {};
        const delta = choice.delta || {};
        if (delta.content && firstAt === null) firstAt = Date.now() - started;
        if (delta.content) text += delta.content;
        if (delta.tool_calls) calls += delta.tool_calls.length;
      },
    });
  } catch (reason) { error = String(reason).slice(0, 200); }
  return { ms: Date.now() - started, firstAt, text: text.slice(0, 120), calls, error };
});
console.log("TOOL_STREAM " + JSON.stringify(result));
await app.close();
