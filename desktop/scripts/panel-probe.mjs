import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-panel", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh");
  localStorage.setItem("hymnix.agents.v1", JSON.stringify({ reviewer: { name: "reviewer", system: "", messages: [{ role: "user", content: "检查 diff" }], updatedAt: Date.now() - 30000 }, scout: { name: "scout", system: "", messages: [{ role: "user", content: "找入口" }], updatedAt: Date.now(), lastError: "timeout" } })); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(() => document.querySelector('[data-session-panel-toggle="true"]')?.click());
await win.waitForTimeout(700);
const state = await win.evaluate(() => ({
  panel: Boolean(document.querySelector(".session-panel")),
  title: document.querySelector(".session-panel-head strong")?.textContent?.trim(),
  sections: [...document.querySelectorAll(".session-panel h4, .session-panel .subagents-head h3")].map((el) => el.textContent?.trim()),
  rows: [...document.querySelectorAll(".session-panel .subagent-row strong")].map((el) => el.textContent?.trim()),
}));
console.log("PANEL " + JSON.stringify(state));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/session-panel.png") });
await win.keyboard.press("Escape");
await win.waitForTimeout(400);
console.log("ESCAPE_CLOSES " + (await win.evaluate(() => !document.querySelector(".session-panel"))));
await app.close();
