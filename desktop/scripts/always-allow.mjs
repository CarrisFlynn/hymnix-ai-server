import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-always", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.removeItem("hymnix.approvals.always.v1"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:8b"); } catch { /* ignore */ } });
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(500);
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen3:8b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(500);
const prompt = "调用 fs.write 工具一次，path 参数为 always-allow-test.txt，content 为 ok。只调用一次，不要解释。";
await win.locator(".composer textarea").fill(prompt);
await win.keyboard.press("Enter");
let seen = { rows: 0, drawer: false };
for (let i = 0; i < 60; i += 1) {
  await win.waitForTimeout(2000);
  const s = await win.evaluate(() => ({ rows: document.querySelectorAll(".approval-row").length, drawer: Boolean(document.querySelector(".approvals-drawer")), err: document.querySelector(".bubble-error")?.textContent?.trim().slice(0, 60) ?? null }));
  if (s.rows > 0) { seen = s; break; }
  if (s.err) { console.log("ERROR " + s.err); break; }
}
console.log("DRAWER " + JSON.stringify(seen));
let after = { rows: -1, toast: null };
if (seen.rows > 0) {
  await win.evaluate(() => {
    const row = document.querySelector(".approval-row");
    const buttons = [...(row?.querySelectorAll("button") ?? [])];
    const always = buttons.find((el) => (el.textContent || "").includes("总是允许"));
    always?.click();
  });
  await win.waitForTimeout(1500);
  const ack = await win.evaluate(() => document.querySelector(".risk-ack input"));
  if (ack) { await win.evaluate(() => { document.querySelector(".risk-ack input")?.click(); }); await win.waitForTimeout(200); await win.evaluate(() => { const b = [...document.querySelectorAll(".risk-dialog .btn")].find((el) => (el.textContent || "").includes("总是允许")); b?.click(); }); }
  for (let i = 0; i < 8; i += 1) {
    await win.waitForTimeout(800);
    after = await win.evaluate(() => ({ rows: document.querySelectorAll(".approval-row").length, toast: document.querySelector(".toast")?.textContent?.trim() ?? null }));
    if (after.rows === 0) break;
  }
}
console.log("AFTER_ALWAYS " + JSON.stringify(after));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/always-allow.png") });
await app.close();
