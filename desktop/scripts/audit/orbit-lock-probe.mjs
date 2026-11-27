import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-orbit-lock", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.3"); localStorage.setItem("hymnix.surface","ai"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1400, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const b = await win.evaluate(() => window.hymnix.bootstrap()); if (b.ready) break; await win.waitForTimeout(400); }

const brand = () => win.evaluate(() => (document.querySelector(".side-brand-name") || {}).textContent || "");
console.log("BEFORE " + await brand() + " / " + await win.evaluate(() => window.__hymnixDev.surfaceNow()));
await win.evaluate(() => window.__hymnixDev.seedRemote(true));
await win.waitForTimeout(600);
console.log("REMOTE_SURFACE " + await brand() + " / " + await win.evaluate(() => window.__hymnixDev.surfaceNow()));
const locked = await win.evaluate(() => {
  const b = [...document.querySelectorAll(".product-menu button")].find((x) => x.textContent.includes("Hymnix AI"));
  return b ? { locked: b.classList.contains("locked"), disabled: b.getAttribute("aria-disabled"), title: b.getAttribute("title") } : null;
});
console.log("MENU_AI " + JSON.stringify(locked));
await win.evaluate(() => { document.querySelector(".side-brand")?.click(); });
await win.waitForTimeout(400);
await win.waitForTimeout(300);
await win.evaluate(() => { const b = [...document.querySelectorAll(".product-menu button")].find((x) => x.textContent.includes("Hymnix AI")); b?.click(); });
await win.waitForTimeout(500);
console.log("AFTER_CLICK_AI " + await win.evaluate(() => window.__hymnixDev.surfaceNow()));
await win.evaluate(() => window.__hymnixDev.seedRemote(false));
await win.waitForTimeout(700);
console.log("RESTORED " + await brand() + " / " + await win.evaluate(() => window.__hymnixDev.surfaceNow()));
await app.close();
