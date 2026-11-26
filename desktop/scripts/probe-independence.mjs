import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-indep", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => {
  localStorage.setItem("hymnix.welcome", "1");
  localStorage.setItem("hymnix.whatsNew", "1.4.0");
  localStorage.setItem("hymnix.lang", "zh");
});
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());

let boot = null;
for (let i = 0; i < 40; i += 1) {
  boot = await win.evaluate(() => window.hymnix.bootstrap());
  if (boot.ready) break;
  await win.waitForTimeout(500);
}
console.log("GATEWAY_UP", JSON.stringify({ ready: boot?.ready, port: boot?.port }));

const before = await win.evaluate(async () => ({
  health: await window.hymnix.gateway.health(),
  models: (await window.hymnix.models.list()).models.map((m) => m.name),
}));
console.log("BEFORE_KILL", JSON.stringify({ ollama: before.health.ollama, models: before.health.models, names: before.models.length }));

// Kill the gateway child, then prove the app still works.
try {
  const pid = execFileSync("powershell", ["-NoProfile", "-Command", "(Get-NetTCPConnection -State Listen -LocalPort " + boot.port + " -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"], { encoding: "utf8" }).trim();
  if (pid) { execFileSync("taskkill", ["/pid", pid, "/t", "/f"]); console.log("KILLED_GATEWAY_PID", pid); }
  else console.log("KILLED_GATEWAY_PID none");
} catch (error) { console.log("KILL_FAILED", String(error).slice(0, 120)); }
await win.waitForTimeout(1500);

const after = await win.evaluate(async () => ({
  health: await window.hymnix.gateway.health().catch((e) => ({ error: String(e).slice(0, 120) })),
  models: (await window.hymnix.models.list()).models.map((m) => m.name),
}));
console.log("AFTER_KILL", JSON.stringify({ ollama: after.health.ollama, models: after.health.models, names: after.models.length, error: after.health.error ?? null }));

// Load the smallest model directly, then chat through the UI with the gateway gone.
const load = await win.evaluate(async () => {
  try { return await window.hymnix.models.start("qwen3:0.6b"); } catch (error) { return { error: String(error).slice(0, 200) }; }
});
console.log("LOAD_MODEL", JSON.stringify(load).slice(0, 200));
await win.waitForTimeout(1200);

await win.evaluate(() => {
  const area = document.querySelector(".composer textarea");
  if (!area) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(area, "reply with the single word: pong");
  area.dispatchEvent(new Event("input", { bubbles: true }));
});
await win.waitForTimeout(300);
await win.keyboard.press("Enter");

let reply = "";
for (let i = 0; i < 90; i += 1) {
  await win.waitForTimeout(1000);
  reply = await win.evaluate(() => {
    const bubbles = [...document.querySelectorAll(".msg-assistant, .assistant .msg-body, [data-role=assistant]")];
    return bubbles.length ? bubbles[bubbles.length - 1].textContent.trim() : "";
  });
  if (reply && reply.length > 0) break;
}
console.log("CHAT_WITHOUT_GATEWAY", JSON.stringify({ chars: reply.length, sample: reply.slice(0, 80) }));
await win.screenshot({ path: resolve(cwd, "../.indep-chat.png") });
await app.close();
