import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-subui", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh");
  localStorage.setItem("hymnix.agents.v1", JSON.stringify({
    reviewer: { name: "reviewer", system: "", messages: [{ role: "user", content: "检查 diff" }, { role: "assistant", content: "两处风险" }], updatedAt: Date.now() - 60000 },
    scout: { name: "scout", system: "", messages: [{ role: "user", content: "找入口" }], updatedAt: Date.now(), lastError: "timeout" },
  })); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(() => window.__hymnixDev.setChatTab("context"));
await win.waitForTimeout(800);
const state = await win.evaluate(() => ({
  title: document.querySelector(".subagents-head h3")?.textContent?.trim(),
  indicator: document.querySelector(".subagents-indicator")?.textContent?.trim(),
  rows: [...document.querySelectorAll(".subagent-row strong")].map((el) => el.textContent?.trim()),
  dots: [...document.querySelectorAll(".subagent-dot")].map((el) => el.className),
}));
console.log("SECTION " + JSON.stringify(state));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/subagents-section.png") });
await app.close();
