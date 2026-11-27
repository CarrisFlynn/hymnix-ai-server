import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-panel3", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh");
  localStorage.setItem("hymnix.agents.v1", JSON.stringify({
    lead: { name: "lead", parent: "", system: "", messages: [{ role: "user", content: "拆分任务" }], updatedAt: Date.now() - 40000 },
    reviewer: { name: "reviewer", parent: "lead", system: "", messages: [{ role: "user", content: "检查 diff" }, { role: "assistant", content: "两处风险" }], updatedAt: Date.now() - 20000 },
    checker: { name: "checker", parent: "reviewer", system: "", messages: [], updatedAt: Date.now(), lastError: "timeout" },
  })); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(() => window.hymnix.jobs.start({ command: "ping -n 30 127.0.0.1", title: "巡检" }).catch(() => null));
await win.evaluate(() => document.querySelector('[data-session-panel-toggle="true"]')?.click());
await win.waitForTimeout(1000);
const tree = await win.evaluate(() => ({
  sections: [...document.querySelectorAll(".session-section h4")].map((el) => el.textContent?.trim()),
  rows: [...document.querySelectorAll(".subagent-name")].map((el) => el.textContent?.trim()),
  jobTime: [...document.querySelectorAll(".session-section")].find((el) => (el.textContent || "").includes("巡检"))?.querySelector(".subagent-main small")?.textContent?.trim(),
}));
console.log("TREE " + JSON.stringify(tree));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/panel-tree.png") });
// reorder: drag 任务 above 子智能体
await win.evaluate(() => { const grip = [...document.querySelectorAll(".section-grip")][2]; grip?.dispatchEvent(new DragEvent("dragstart", { bubbles: true })); });
await win.waitForTimeout(200);
await win.evaluate(() => { const target = document.querySelectorAll(".session-section-wrap")[1]; target?.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true })); target?.dispatchEvent(new DragEvent("drop", { bubbles: true })); });
await win.waitForTimeout(300);
const order = await win.evaluate(() => [...document.querySelectorAll(".session-section h4")].map((el) => el.textContent?.trim()));
console.log("ORDER " + JSON.stringify(order));
await win.evaluate(() => { const b = [...document.querySelectorAll(".subagent-name")].find((el) => el.textContent?.trim() === "reviewer"); b?.click(); });
await win.waitForTimeout(500);
console.log("DETAIL " + JSON.stringify(await win.evaluate(() => ({ back: document.querySelector(".subagent-breadcrumb button")?.textContent?.trim(), path: document.querySelector(".subagent-breadcrumb span")?.textContent?.trim(), title: document.querySelector(".subagent-detail h4")?.textContent?.trim() }))));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/panel-detail.png") });
await app.close();
