import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-indep2", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
let boot = null;
for (let i = 0; i < 40; i += 1) { boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }

// kill the gateway process listening on this app's own port
const pid = execFileSync("powershell", ["-NoProfile", "-Command", "(Get-NetTCPConnection -State Listen -LocalPort " + boot.port + " -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"], { encoding: "utf8" }).trim();
if (pid) { try { execFileSync("taskkill", ["/pid", pid, "/t", "/f"]); } catch { /* gone */ } }
console.log("GATEWAY_DEAD", JSON.stringify({ port: boot.port, pid: pid || null }));
await win.waitForTimeout(1500);

await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:0.6b"); } catch { /* already */ } });
const streamed = await win.evaluate(async () => {
  const requestId = "probe-" + Date.now();
  let text = "";
  try {
    await window.hymnix.gateway.streamChat({
      requestId, baseUrl: (await window.hymnix.bootstrap()).base, apiKey: "", model: "qwen3:0.6b",
      messages: [{ role: "user", content: "Reply with exactly one word: pong" }],
      onDelta: (part) => { const d = part?.choices?.[0]?.delta || {}; if (d.content) text += d.content; },
    });
    return { ok: true, text: text.slice(0, 120), chars: text.length };
  } catch (error) { return { ok: false, error: String(error).slice(0, 200) }; }
});
console.log("DIRECT_CHAT", JSON.stringify(streamed));
await app.close();
