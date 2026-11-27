import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd()); const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-a11y", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh");
  localStorage.setItem("hymnix.agents.v1", JSON.stringify({ lead: { name: "lead", parent: "", system: "", messages: [{ role: "user", content: "开始" }, { role: "assistant", content: "收到" }], updatedAt: Date.now() } })); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(() => document.querySelector('[data-session-panel-toggle="true"]')?.click());
await win.waitForTimeout(600);
const focus1 = await win.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName);
// keyboard reorder: focus the jobs grip and press ArrowUp twice
await win.evaluate(() => { const grip = document.querySelectorAll(".section-grip")[2]; grip?.focus(); });
await win.keyboard.press("ArrowUp");
await win.waitForTimeout(300);
const orderAfterKey = await win.evaluate(() => [...document.querySelectorAll(".session-section h4")].map((el) => el.textContent?.trim()));
// tab loops inside the panel
await win.evaluate(() => { const panel = document.querySelector(".session-panel"); const last = panel?.querySelectorAll("button, input")?.length; const nodes = panel?.querySelectorAll("button, input"); (nodes && nodes.length ? nodes[nodes.length - 1] : null)?.focus(); });
await win.keyboard.press("Tab");
const wrapped = await win.evaluate(() => Boolean(document.querySelector(".session-panel")?.contains(document.activeElement)));
// open a subagent and use its composer
await win.evaluate(() => { const b = [...document.querySelectorAll(".subagent-name")][0]; b?.click(); });
await win.waitForTimeout(400);
const detail = await win.evaluate(() => ({ composer: Boolean(document.querySelector(".subagent-composer input")), placeholder: document.querySelector(".subagent-composer input")?.getAttribute("placeholder") }));
console.log("A11Y " + JSON.stringify({ focus1, orderAfterKey, wrapped, detail }));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/panel-detail-composer.png") });
await win.keyboard.press("Escape");
await win.waitForTimeout(300);
const restored = await win.evaluate(() => document.activeElement?.getAttribute("data-session-panel-toggle") === "true");
console.log("RESTORE " + restored);
await app.close();
