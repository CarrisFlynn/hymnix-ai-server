import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-ipc-native", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:8b"); } catch { /* ignore */ } });
const result = await win.evaluate(async () => {
  const base = (await window.hymnix.bootstrap()).base;
  const started = Date.now();
  let firstAt = null, text = "", thinking = 0, calls = 0, error = null;
  const tools = [{ type: "function", function: { name: "todo_write", description: "Publish the plan", parameters: { type: "object", properties: { todos: { type: "array", items: { type: "object", properties: { content: { type: "string" }, status: { type: "string" } }, required: ["content"] } } }, required: ["todos"] } } }];
  try {
    await window.hymnix.gateway.streamChat({
      requestId: "ipc-native-" + started, baseUrl: base, apiKey: "", model: "qwen3:8b",
      messages: [{ role: "user", content: "Call todo_write with one step: say hello." }],
      tools,
      onDelta: (part) => {
        const d = part?.choices?.[0]?.delta || {};
        if (d.content && firstAt === null) firstAt = Date.now() - started;
        if (d.content) text += d.content;
        if (d.reasoning_content) thinking += d.reasoning_content.length;
        if (d.tool_calls) calls += d.tool_calls.length;
      },
    });
  } catch (reason) { error = String(reason).slice(0, 200); }
  return { ms: Date.now() - started, firstAt, textLen: text.length, thinking, calls, error };
});
console.log("IPC_NATIVE " + JSON.stringify(result));
await app.close();
