import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-final-loop", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.setItem("hymnix.surface","orbit"); localStorage.removeItem("hymnix.approvals.always.v1"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
// preload so the UI send does not pay the load cost inside the request
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen2.5-coder:7b"); } catch { /* ignore */ } });
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(500);
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen2.5-coder:7b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(400);
const target = resolve(cwd, "../audit-final.txt");
if (existsSync(target)) rmSync(target);
await win.locator(".composer textarea").fill("调用 fs.write 在 audit-final.txt 写入 ok，然后回答 完成。");
await win.keyboard.press("Enter");
let seen = { drawer: false, errors: [], plan: 0, replied: "" };
for (let i = 0; i < 60; i += 1) {
  await win.waitForTimeout(2000);
  const state = await win.evaluate(() => ({
    drawer: Boolean(document.querySelector(".approvals-drawer")),
    rows: document.querySelectorAll(".approval-row").length,
    error: document.querySelector(".bubble-error")?.textContent?.trim() ?? null,
    bodies: [...document.querySelectorAll(".bubble.assistant .bubble-body")].map((el) => el.textContent.trim()).filter(Boolean),
    plan: document.querySelectorAll(".plan-step").length,
  }));
  if (state.error) seen.errors.push(state.error.slice(0, 100));
  if (state.plan) seen.plan = state.plan;
  if (state.drawer && state.rows) {
    seen.drawer = true;
    console.log("APPROVAL_AT " + i);
    await win.evaluate(() => { const row = document.querySelector(".approval-row"); [...(row?.querySelectorAll("button") ?? [])].find((el) => (el.textContent || "").includes("允许一次"))?.click(); });
    await win.waitForTimeout(2500);
    continue;
  }
  if (state.bodies.length) { seen.replied = state.bodies[state.bodies.length - 1]; break; }
}
console.log("FINAL " + JSON.stringify({ ...seen, file: existsSync(target), fileText: existsSync(target) ? readFileSync(target, "utf8").slice(0, 30) : null }));
await win.evaluate(() => window.__hymnixDev.setChatTab("plan"));
await win.waitForTimeout(500);
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/final-loop.png") });
await app.close();
