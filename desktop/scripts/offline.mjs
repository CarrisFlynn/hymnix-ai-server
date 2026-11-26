import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env, OLLAMA_HOST: "127.0.0.1:1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-offline", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 20; i += 1) { await win.waitForTimeout(500); }
const state = await win.evaluate(async () => {
  const health = await window.hymnix.gateway.health();
  const card = document.querySelector(".chat-ready-card");
  return {
    health,
    cardTitle: card?.querySelector("h2")?.textContent?.trim() ?? null,
    buttons: [...(card?.querySelectorAll("button") ?? [])].map((el) => el.textContent?.trim()),
    banner: document.querySelector(".error-bar, .connection-error, [role=alert]")?.textContent?.trim() ?? null,
    status: document.querySelector(".statusbar")?.textContent?.trim().slice(0, 60) ?? null,
  };
});
console.log("OFFLINE_STATE", JSON.stringify(state));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/offline.png") });
await app.close();
