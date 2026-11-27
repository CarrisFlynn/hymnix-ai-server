import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-nav", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
const def = await win.evaluate(() => window.hymnix.code.definition("streamTurn"));
console.log("DEF " + JSON.stringify({ ok: def.ok, hits: (def.hits || []).slice(0, 2).map((h) => h.file + ":" + h.line) }));
const outline = await win.evaluate(() => window.hymnix.code.outline("desktop/src/main/code-nav.ts"));
console.log("OUTLINE " + JSON.stringify({ ok: outline.ok, first: (outline.symbols || []).slice(0, 3).map((s) => s.name + "@" + s.line) }));
const refs = await win.evaluate(() => window.hymnix.code.references("consumeRound"));
console.log("REFS " + JSON.stringify({ ok: refs.ok, count: (refs.hits || []).length }));
// one named agent round against the local model
const agent = await win.evaluate(async () => {
  try { await window.hymnix.models.start("qwen3:0.6b"); } catch {}
  const reply = await window.hymnix.gateway.complete({
    baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:0.6b", kind: "openai",
    messages: [{ role: "system", content: "You are a terse assistant." }, { role: "user", content: "只回复：代理在线" }],
  });
  return { ok: reply.ok, text: (reply.text || "").slice(0, 30), error: (reply.error || "").slice(0, 60) };
});
console.log("AGENT " + JSON.stringify(agent));
await app.close();
