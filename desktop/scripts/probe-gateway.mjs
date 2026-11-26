import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-gw-check", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());

let ready = false;
for (let i = 0; i < 40; i += 1) {
  const boot = await win.evaluate(() => window.hymnix.bootstrap());
  if (boot.ready) { ready = true; console.log("BOOTSTRAP_READY", JSON.stringify({ port: boot.port, external: boot.external, state: boot.state })); break; }
  await win.waitForTimeout(500);
}
if (!ready) console.log("BOOTSTRAP_FAILED", JSON.stringify(await win.evaluate(() => window.hymnix.bootstrap())));
await win.waitForTimeout(2500);
const snapshot = await win.evaluate(async () => {
  const health = await window.hymnix.gateway.health().catch((error) => ({ error: String(error) }));
  const models = await window.hymnix.models.list().catch((error) => ({ error: String(error) }));
  const status = [...document.querySelectorAll(".statusbar *")].map((el) => el.textContent?.trim()).filter(Boolean).slice(0, 12);
  const errorBanner = document.querySelector(".startup-note, .error-bar, [role=alert]")?.textContent?.trim() ?? null;
  return { health, models, status, errorBanner };
});
console.log("RUNTIME", JSON.stringify(snapshot).slice(0, 1200));
await win.screenshot({ path: resolve(cwd, "../.gw-ready.png") });
await app.close();
