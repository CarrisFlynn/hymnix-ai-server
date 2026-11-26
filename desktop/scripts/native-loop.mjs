import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-native", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.setItem("hymnix.surface","orbit"); localStorage.removeItem("hymnix.approvals.always.v1"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
// native tools need a tool-capable model; qwen3:8b around here
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:8b"); } catch { /* ignore */ } });
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(500);
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen3:8b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(400);
const target = resolve(cwd, "../audit-native.txt");
if (existsSync(target)) rmSync(target);
await win.locator(".composer textarea").fill("用 todo_write 发布两步计划，然后用 fs.write 在 audit-native.txt 写入 done，最后回答 完成。");
await win.keyboard.press("Enter");
let result = { plan: 0, approval: false, file: false, reply: "", error: null };
for (let i = 0; i < 60; i += 1) {
  await win.waitForTimeout(2000);
  const state = await win.evaluate(() => ({
    drawer: Boolean(document.querySelector(".approvals-drawer")),
    rows: document.querySelectorAll(".approval-row").length,
    plan: document.querySelectorAll(".plan-step").length,
    error: document.querySelector(".bubble-error")?.textContent?.trim() ?? null,
    bodies: [...document.querySelectorAll(".bubble.assistant .bubble-body")].map((el) => el.textContent.trim()).filter(Boolean),
  }));
  result.plan = Math.max(result.plan, state.plan);
  if (state.error) result.error = state.error.slice(0, 90);
  if (state.drawer && state.rows) {
    result.approval = true;
    console.log("APPROVAL_AT " + i);
    await win.evaluate(() => { const row = document.querySelector(".approval-row"); [...(row?.querySelectorAll("button") ?? [])].find((el) => (el.textContent || "").includes("允许一次"))?.click(); });
    await win.waitForTimeout(2500);
    continue;
  }
  const real = state.bodies.filter((body) => body && !/正在思考|Thinking/i.test(body));
  if (real.length && !(await win.evaluate(() => Boolean(document.querySelector(".bubble.assistant.generating"))))) { result.reply = real[real.length - 1]; break; }
  if (i % 6 === 0) console.log("T" + i + " " + JSON.stringify({ plan: state.plan, drawer: state.drawer, bodies: state.bodies.length }));
}
result.file = existsSync(target);
console.log("NATIVE " + JSON.stringify({ ...result, reply: result.reply.slice(0, 60), fileText: result.file ? readFileSync(target, "utf8").slice(0, 30) : null }));
await win.evaluate(() => window.__hymnixDev.setChatTab("plan"));
await win.waitForTimeout(500);
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/native-plan.png") });
await app.close();
