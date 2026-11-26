import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-clean-mwx3e78b", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("hymnix.welcome","1");
  localStorage.setItem("hymnix.whatsNew","1.4.0");
  localStorage.setItem("hymnix.lang","zh");
  localStorage.setItem("hymnix.surface","orbit");
});
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
const toolsOk = await win.evaluate(() => window.hymnix.tools.list().then((r) => r.tools.some((t) => t.name === "fs.write")).catch(() => false));
console.log("TOOLS_READY " + toolsOk);
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:8b"); } catch { /* ignore */ } });
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(500);
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen3:8b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(400);
const target = resolve(cwd, "../audit-clean.txt");
if (existsSync(target)) rmSync(target);
await win.locator(".composer textarea").fill("调用 fs.write 工具写文件 audit-clean.txt，内容 done。");
await win.keyboard.press("Enter");
console.log("SENT " + JSON.stringify(await win.evaluate(() => ({ user: document.querySelectorAll(".bubble.user").length }))));
for (let i = 0; i < 40; i += 1) {
  await win.waitForTimeout(5000);
  const s = await win.evaluate(() => ({
    banner: document.querySelector(".loop-banner span:nth-child(2)")?.textContent?.trim() ?? null,
    drawer: Boolean(document.querySelector(".approvals-drawer")),
    rows: document.querySelectorAll(".approval-row").length,
    error: document.querySelector(".bubble-error")?.textContent?.trim().slice(0, 80) ?? null,
  }));
  if (s.drawer && s.rows) {
    console.log("APPROVAL_AT " + i);
    await win.evaluate(() => { const row = document.querySelector(".approval-row"); [...(row?.querySelectorAll("button") ?? [])].find((el) => (el.textContent || "").includes("允许一次"))?.click(); });
    await win.waitForTimeout(4000);
    if (existsSync(target)) { console.log("FILE_AFTER_APPROVAL " + readFileSync(target, "utf8").slice(0, 20)); break; }
    continue;
  }
  if (existsSync(target)) { console.log("FILE_WRITTEN_AT " + i); break; }
  if (s.error) { console.log("ERROR " + s.error); break; }
  if (i % 3 === 0) console.log("S" + i + " " + JSON.stringify(s));
}
console.log("FINAL " + JSON.stringify({ file: existsSync(target), text: existsSync(target) ? readFileSync(target, "utf8") : null }));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/clean-loop.png") });
await app.close();
