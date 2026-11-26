import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-diag", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.removeItem("hymnix.chat.sessions.v2"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:0.6b"); } catch { /* ignore */ } });

// pick the model
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(400);
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen3:0.6b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(500);

// send and dump everything
await win.locator(".composer textarea").fill("Reply with exactly one word: pong");
await win.keyboard.press("Enter");
await win.waitForTimeout(6000);
const dump = await win.evaluate(() => ({
  bubbles: [...document.querySelectorAll(".bubble")].map((el) => ({ cls: el.className, text: (el.textContent || "").trim().slice(0, 80) })),
  bubbleError: document.querySelector(".bubble-error")?.textContent?.trim() ?? null,
  errorBar: document.querySelector(".composer-note, .error-bar, [role=alert]")?.textContent?.trim() ?? null,
  draft: document.querySelector(".composer textarea")?.value ?? null,
  busy: Boolean(document.querySelector(".bubble.assistant.generating")),
  chatState: document.querySelector(".statusbar")?.textContent?.trim().slice(0, 120) ?? null,
}));
console.log("DUMP", JSON.stringify(dump).slice(0, 1500));

// terminal dump
await win.evaluate(() => window.__hymnixDev.navigate("Terminal"));
await win.waitForTimeout(800);
const termShape = await win.evaluate(() => ({
  inputs: [...document.querySelectorAll("input, textarea")].map((el) => el.className || el.tagName),
  containers: [...document.querySelectorAll("[class*=term]")].map((el) => el.className).slice(0, 12),
}));
console.log("TERM_SHAPE", JSON.stringify(termShape).slice(0, 800));
await win.locator(".term-input input").fill("echo diag-probe");
await win.locator(".term-input").press("Enter");
await win.waitForTimeout(2500);
const termDump = await win.evaluate(() => {
  const body = document.body.innerText;
  const index = body.indexOf("diag-probe");
  return { found: index >= 0, around: index >= 0 ? body.slice(Math.max(0, index - 120), index + 160) : body.slice(-300) };
});
console.log("TERM_DUMP", JSON.stringify(termDump).slice(0, 900));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/diag.png") });
await app.close();
