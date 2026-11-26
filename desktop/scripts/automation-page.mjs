import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-auto2", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(async () => {
  await window.hymnix.automation.create({ title: "晨间仓库检查", prompt: "检查未提交的改动，列出风险点。", rule: { kind: "daily", time: "09:00" } });
  await window.hymnix.automation.create({ title: "周报草稿", prompt: "汇总本周提交，写一份周报草稿。", rule: { kind: "weekly", time: "18:30", weekdays: [5] } });
  await window.hymnix.automation.create({ title: "每两小时巡检", prompt: "看一眼后台任务有没有失败。", rule: { kind: "every", seconds: 7200 } });
});
await win.evaluate(() => window.__hymnixDev.navigate("Automation"));
await win.waitForTimeout(900);
const state = await win.evaluate(() => ({ rows: document.querySelectorAll(".automation-row").length, empty: Boolean(document.querySelector(".automation-empty")), first: document.querySelector(".automation-row small")?.textContent?.trim() }));
console.log("PAGE " + JSON.stringify(state));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/automation-page.png") });
await win.evaluate(() => document.querySelector(".page-actions .btn")?.click());
await win.waitForTimeout(600);
console.log("DIALOG " + JSON.stringify(await win.evaluate(() => ({ open: Boolean(document.querySelector(".automation-dialog")), fields: document.querySelectorAll(".automation-field").length }))));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/automation-dialog.png") });
await app.close();
