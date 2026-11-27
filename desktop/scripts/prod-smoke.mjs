import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-prod-smoke", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.hymnix && window.hymnix.bootstrap), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.2"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.hymnix && window.hymnix.bootstrap), null, { timeout: 60000 });
let boot = null;
for (let i = 0; i < 60; i += 1) { boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
console.log("PROD_BOOT " + Boolean(boot && boot.ready));
console.log("PROD_HAS_DEVHOOK " + String(await win.evaluate(() => typeof window.__hymnixDev !== "undefined")));
console.log("PROD_RENDERED " + String(await win.evaluate(() => Boolean(document.querySelector(".composer") || document.querySelector("nav")))));
await win.screenshot({ path: resolve(cwd, "dist-prod-smoke.png") });
await app.close();
