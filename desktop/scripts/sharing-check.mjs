import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-share", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
const nav = await win.evaluate(() => [...document.querySelectorAll(".nav-item, .side-nav button")].map((el) => el.textContent?.trim()).filter(Boolean));
console.log("NAV " + JSON.stringify(nav));
await win.evaluate(() => window.__hymnixDev.navigate("Gateway"));
await win.waitForTimeout(1200);
const share = await win.evaluate(() => ({
  h2: document.querySelector(".view-page h2")?.textContent?.trim(),
  cards: [...document.querySelectorAll(".view-page h3, .view-page .card-title")].map((el) => el.textContent?.trim()).filter(Boolean),
  nested: document.querySelectorAll(".view-page .view-page").length,
  monitorHead: [...document.querySelectorAll("h2")].map((el) => el.textContent?.trim()),
}));
console.log("SHARING " + JSON.stringify(share));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/sharing-merged.png"), fullPage: true });
await app.close();
