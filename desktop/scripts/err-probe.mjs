import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-err", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.setItem("hymnix.surface","orbit"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen2.5-coder:7b"); } catch { /* ignore */ } });
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(500);
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen2.5-coder:7b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(500);
console.log("SURFACE " + JSON.stringify(await win.evaluate(() => ({ chip: document.querySelector(".surface-chip")?.textContent, mode: window.__hymnixDev ? "dev" : "?" }))));
await win.locator(".composer textarea").fill("say hi in one word");
await win.keyboard.press("Enter");
for (let i = 0; i < 20; i += 1) {
  await win.waitForTimeout(1500);
  const dump = await win.evaluate(() => ({
    err: document.querySelector(".bubble-error")?.textContent?.trim() ?? null,
    body: [...document.querySelectorAll(".bubble.assistant .bubble-body")].map((el) => el.textContent.trim()).join("|").slice(0, 120),
    status: document.querySelector(".statusbar")?.textContent?.trim().slice(0, 50),
    note: document.querySelector(".startup-note, .composer-hint")?.textContent?.trim() ?? null,
  }));
  if (dump.err || dump.body) { console.log("DUMP " + JSON.stringify(dump)); break; }
  if (i === 19) console.log("TIMEOUT " + JSON.stringify(dump));
}
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/err.png") });
await app.close();
