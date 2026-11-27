import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-panel2", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh");
  localStorage.setItem("hymnix.agents.v1", JSON.stringify({
    lead: { name: "lead", parent: "", system: "", messages: [{ role: "user", content: "拆分任务" }, { role: "assistant", content: "已拆成两步" }], updatedAt: Date.now() - 40000 },
    reviewer: { name: "reviewer", parent: "lead", system: "", messages: [{ role: "user", content: "检查 diff" }], updatedAt: Date.now() - 20000 },
    checker: { name: "checker", parent: "reviewer", system: "", messages: [], updatedAt: Date.now(), lastError: "timeout" },
  })); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(() => window.hymnix.jobs.start({ command: "ping -n 30 127.0.0.1", title: "巡检" }).catch(() => null));
await win.evaluate(() => document.querySelector('[data-session-panel-toggle="true"]')?.click());
await win.waitForTimeout(900);
const state = await win.evaluate(() => ({
  sections: [...document.querySelectorAll(".session-section h4")].map((el) => el.textContent?.trim()),
  rows: [...document.querySelectorAll(".subagent-name")].map((el) => el.textContent?.trim()),
  indents: [...document.querySelectorAll(".subagent-row")].map((el) => el.style.paddingLeft || "0"),
  chevrons: document.querySelectorAll(".subagent-chevron:not(.empty)").length,
  grips: document.querySelectorAll(".section-grip").length,
  jobs: [...document.querySelectorAll(".session-section")].filter((el) => (el.textContent || "").includes("任务")).length,
}));
console.log("PANEL " + JSON.stringify(state));
await win.evaluate(() => { const b = [...document.querySelectorAll(".subagent-name")].find((el) => el.textContent?.trim() === "reviewer"); b?.click(); });
await win.waitForTimeout(600);
const detail = await win.evaluate(() => ({ breadcrumb: document.querySelector(".subagent-breadcrumb span")?.textContent?.trim(), transcript: document.querySelectorAll(".subagent-transcript li").length }));
console.log("DETAIL " + JSON.stringify(detail));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/session-panel-tree.png") });
await win.evaluate(() => { const back = [...document.querySelectorAll(".subagent-breadcrumb button")][0]; back?.click(); });
await win.waitForTimeout(400);
await win.evaluate(() => { const row = document.querySelector(".subagent-row"); row?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
await win.waitForTimeout(300);
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/session-panel-tree2.png") });
await app.close();
