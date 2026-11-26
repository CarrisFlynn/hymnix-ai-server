import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-loop-final", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.setItem("hymnix.surface","orbit"); localStorage.removeItem("hymnix.approvals.always.v1"); localStorage.removeItem("hymnix.chat.sessions.v2"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
// preload so the load cost is outside the turn
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:8b"); } catch { /* ignore */ } });
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(500);
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen3:8b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(400);
const target = resolve(cwd, "../audit-loop-final.txt");
if (existsSync(target)) rmSync(target);
await win.locator(".composer textarea").fill("调用 fs.write 工具，路径 audit-loop-final.txt，内容 done。");
await win.keyboard.press("Enter");
let last = {};
for (let i = 0; i < 45; i += 1) {
  await win.waitForTimeout(4000);
  last = await win.evaluate(() => ({
    banner: document.querySelector(".loop-banner span:nth-child(2)")?.textContent?.trim() ?? null,
    userBubbles: document.querySelectorAll(".bubble.user").length,
    assistant: document.querySelectorAll(".bubble.assistant").length,
    thinking: document.querySelectorAll(".bubble-think").length,
    generating: Boolean(document.querySelector(".bubble.assistant.generating")),
    error: document.querySelector(".bubble-error")?.textContent?.trim().slice(0, 70) ?? null,
    drawer: Boolean(document.querySelector(".approvals-drawer")),
    rows: document.querySelectorAll(".approval-row").length,
  }));
  console.log("S" + i + " " + JSON.stringify(last));
  if (last.drawer && last.rows) {
    await win.evaluate(() => { const row = document.querySelector(".approval-row"); [...(row?.querySelectorAll("button") ?? [])].find((el) => (el.textContent || "").includes("允许一次"))?.click(); });
    console.log("APPROVED_AT " + i);
    await win.waitForTimeout(6000);
    continue;
  }
  if (last.error) break;
  if (existsSync(target)) { console.log("FILE_WRITTEN_AT " + i); break; }
}
console.log("FINAL " + JSON.stringify({ file: existsSync(target), text: existsSync(target) ? readFileSync(target, "utf8").slice(0, 20) : null, last }));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/loop-final.png") });
await app.close();
