import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-auto3", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
// pick a model the way a person would, so the fire path has one to use
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:0.6b"); } catch { /* ignore */ } });
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(500);
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen3:0.6b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(400);
await win.evaluate(() => window.hymnix.automation.create({ title: "auto-behavior", prompt: "只回复两个字：准时", rule: { kind: "at", at: Date.now() + 4000 } }));
console.log("CREATED");
let out = { user: "", assistant: "", toast: null, error: "" };
for (let i = 0; i < 50; i += 1) {
  await win.waitForTimeout(1500);
  out = await win.evaluate(() => ({
    user: [...document.querySelectorAll(".bubble.user")].map((el) => el.textContent.trim()).slice(-1)[0] ?? "",
    assistant: [...document.querySelectorAll(".bubble.assistant")].map((el) => el.textContent.trim()).slice(-1)[0] ?? "",
    toast: document.querySelector(".toast")?.textContent?.trim() ?? null,
    error: document.querySelector(".bubble-error")?.textContent?.trim().slice(0, 80) ?? "",
  }));
  if (out.assistant && out.assistant.length > 1 && !out.assistant.includes("正在思考")) break;
}
console.log("RESULT " + JSON.stringify({ user: out.user.slice(0, 40), assistant: out.assistant.slice(0, 60), toast: out.toast, error: out.error }));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/automation-run.png") });
await app.close();
