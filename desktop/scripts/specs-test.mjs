import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-specs", "."], cwd, env });
const win = await app.firstWindow();
app.process().stderr?.on("data", (chunk) => console.log("MAIN_ERR " + chunk.toString().trim().slice(0, 300)));
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
const result = await win.evaluate(async () => {
  const tools = (await window.hymnix.tools.list()).tools;
  const specs = [{ type: "function", function: { name: "todo_write", description: "Publish the plan", parameters: { type: "object", properties: { todos: { type: "array", items: { type: "object", properties: { content: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] } }, required: ["content", "status"] } } }, required: ["todos"] } } }]
    .concat(tools.filter((item) => ["fs.write", "fs.read", "fs.list", "repo.search"].includes(item.name)).map((item) => ({ type: "function", function: { name: item.name, description: item.description, parameters: item.schema } })));
  const base = (await window.hymnix.bootstrap()).base;
  const started = Date.now();
  let text = "", calls = 0, error = null;
  try {
    await window.hymnix.gateway.streamChat({
      requestId: "specs-" + started, baseUrl: base, apiKey: "", model: "qwen2.5-coder:7b",
      messages: [{ role: "system", content: "You are a coding agent. Publish a plan with todo_write." }, { role: "user", content: "在 audit-specs.txt 写入 ok" }],
      tools: specs,
      onDelta: (part) => { const d = part?.choices?.[0]?.delta || {}; if (d.content) text += d.content; if (d.tool_calls) calls += d.tool_calls.length; },
    });
  } catch (reason) { error = String(reason).slice(0, 240); }
  return { ms: Date.now() - started, calls, text: text.slice(0, 120), error, count: specs.length };
});
console.log("SPECS_TEST " + JSON.stringify(result));
await app.close();
