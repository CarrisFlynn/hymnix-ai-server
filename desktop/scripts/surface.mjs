import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-surface", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.setItem("hymnix.surface","ai"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:0.6b"); } catch { /* ignore */ } });
await win.waitForTimeout(1500);
// force the plain state by selecting the loaded model
// select the loaded small model through the real popover so the plain state shows
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(400);
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen3:0.6b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(900);
const readSurface = () => win.evaluate(() => ({
  brand: document.querySelector(".side-brand-name")?.textContent?.trim(),
  chip: document.querySelector(".surface-chip")?.textContent?.trim() ?? null,
  card: document.querySelector(".chat-ready-card h2")?.textContent?.trim() ?? null,
  eyebrow: document.querySelector(".chat-landing-head .eyebrow")?.textContent?.trim() ?? null,
  heading: document.querySelector(".chat-landing-head h2")?.textContent?.trim() ?? null,
  starters: [...document.querySelectorAll(".starter")].map((el) => el.textContent?.trim()),
  tabPlan: [...document.querySelectorAll(".chat-tabs button")].some((el) => (el.textContent || "").includes("计划")),
}));
console.log("AI_SURFACE", JSON.stringify(await readSurface()));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/surface-ai.png") });
await win.evaluate(() => { document.querySelector(".side-brand")?.click(); });
await win.waitForTimeout(400);
await win.evaluate(() => { [...document.querySelectorAll("[role=menuitemradio], .product-menu button")].find((el) => (el.textContent || "").includes("Orbit"))?.click(); });
await win.waitForTimeout(900);
console.log("ORBIT_SURFACE", JSON.stringify(await readSurface()));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/surface-orbit.png") });
await app.close();
