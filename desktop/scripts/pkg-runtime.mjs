import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: resolve(cwd, "../release/win-unpacked/Hymnix Orbit.exe"), args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-pkg"], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 90000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 90000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
let boot = null;
for (let i = 0; i < 60; i += 1) { boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
const health = await win.evaluate(() => window.hymnix.gateway.health());
const models = await win.evaluate(() => window.hymnix.models.list().then((r) => r.models.map((m) => m.name)));
console.log("PACKAGED_RUNTIME " + JSON.stringify({ ready: boot?.ready, state: boot?.state, error: boot?.error ?? null, ollama: health.ollama, healthModels: health.models, models: models.length }));
// chat through the packaged main process, gateway alive
const chat = await win.evaluate(async () => {
  await window.hymnix.models.start("qwen3:0.6b").catch(() => undefined);
  const base = (await window.hymnix.bootstrap()).base;
  let text = "";
  await window.hymnix.gateway.streamChat({ requestId: "pkg-" + Date.now(), baseUrl: base, apiKey: "", model: "qwen3:0.6b", messages: [{ role: "user", content: "say pong" }], onDelta: (part) => { const d = part?.choices?.[0]?.delta || {}; if (d.content) text += d.content; } });
  return text.slice(0, 60);
});
console.log("PACKAGED_CHAT " + JSON.stringify(chat));
await app.close();
