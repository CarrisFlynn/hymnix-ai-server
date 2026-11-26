import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-auto4", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:0.6b"); } catch (e) { /* ignore */ } });
const chipBefore = await win.evaluate(() => document.querySelector(".cb-chip.model")?.textContent?.trim() ?? "");
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(500);
const options = await win.evaluate(() => [...document.querySelectorAll(".mp-option")].map((el) => el.textContent?.trim().slice(0, 24)));
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen3:0.6b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(400);
const chipAfter = await win.evaluate(() => document.querySelector(".cb-chip.model")?.textContent?.trim() ?? "");
console.log("CHIP " + JSON.stringify({ before: chipBefore, after: chipAfter, options: options.slice(0, 4) }));
const created = await win.evaluate(() => window.hymnix.automation.create({ title: "auto-behavior", prompt: "只回复两个字：准时", rule: { kind: "at", at: Date.now() + 4000 } }));
console.log("CREATED " + JSON.stringify(created).slice(0, 160));
for (let i = 0; i < 24; i += 1) {
  await win.waitForTimeout(2500);
  const s = await win.evaluate(() => ({
    title: document.querySelector(".chat-title")?.textContent?.trim() ?? "",
    draft: document.querySelector(".composer textarea")?.value?.slice(0, 20) ?? "",
    user: document.querySelectorAll(".bubble.user").length,
    assistant: document.querySelectorAll(".bubble.assistant").length,
    toast: document.querySelector(".toast")?.textContent?.trim() ?? null,
    note: document.querySelector(".startup-note")?.textContent?.trim()?.slice(0, 40) ?? null,
    banner: document.querySelector(".loop-banner span:nth-child(2)")?.textContent?.trim() ?? null,
  }));
  if (i % 4 === 0 || s.user > 0) console.log("T" + i + " " + JSON.stringify(s));
  if (s.user > 0) break;
}
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/automation-run2.png") });
await app.close();
