import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-auto", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
// wait for the model so the fired prompt can actually run
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:0.6b"); } catch { /* ignore */ } });

const created = await win.evaluate(async () => {
  const at = Date.now() + 4000;
  return window.hymnix.automation.create({ title: "probe-task", prompt: "Reply with the word scheduled.", rule: { kind: "at", at } });
});
console.log("CREATED " + JSON.stringify({ ok: created.ok, id: created.task?.id, error: created.error }));
const listed = await win.evaluate(() => window.hymnix.automation.list().then((r) => r.tasks.map((t) => ({ title: t.title, nextAt: t.nextAt, enabled: t.enabled }))));
console.log("LIST " + JSON.stringify(listed));

let fired = false, session = "", userText = "";
for (let i = 0; i < 40; i += 1) {
  await win.waitForTimeout(1000);
  const state = await win.evaluate(() => ({
    title: document.querySelector(".chat-title")?.textContent?.trim(),
    user: [...document.querySelectorAll(".bubble.user")].map((el) => el.textContent.trim()).slice(-1)[0] ?? "",
    toast: document.querySelector(".toast")?.textContent?.trim() ?? null,
  }));
  if (state.user.includes("scheduled") || state.title === "probe-task") { fired = true; session = state.title; userText = state.user.slice(0, 60); break; }
}
console.log("FIRED " + JSON.stringify({ fired, session, userText }));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/automation.png") });
await app.close();
