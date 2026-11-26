import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-native2", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.setItem("hymnix.surface","orbit"); localStorage.removeItem("hymnix.approvals.always.v1"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
let ready = false;
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) { ready = true; break; } await win.waitForTimeout(500); }
console.log("READY " + ready);
const tools = await win.evaluate(() => window.hymnix.tools.list().then((r) => r.tools.map((t) => t.name)).catch((e) => String(e).slice(0, 80)));
console.log("TOOLS " + JSON.stringify(tools));
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:8b"); } catch { /* ignore */ } });
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(500);
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen3:8b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(400);
const target = resolve(cwd, "../audit-native2.txt");
if (existsSync(target)) rmSync(target);
await win.locator(".composer textarea").fill("调用 todo_write 发布两步计划（先写文件，再确认），然后调用 fs.write 在 audit-native2.txt 写入 done。");
await win.keyboard.press("Enter");
let plan = 0, approval = false, reply = "", error = null;
for (let i = 0; i < 70; i += 1) {
  await win.waitForTimeout(2000);
  const state = await win.evaluate(() => {
    const drawer = Boolean(document.querySelector(".approvals-drawer"));
    return {
      drawer,
      rows: document.querySelectorAll(".approval-row").length,
      generating: Boolean(document.querySelector(".bubble.assistant.generating")),
      error: document.querySelector(".bubble-error")?.textContent?.trim() ?? null,
      bodies: [...document.querySelectorAll(".bubble.assistant .bubble-body")].map((el) => el.textContent.trim()).filter((t) => t && !/正在思考|Thinking/i.test(t)),
    };
  });
  if (state.error) error = state.error.slice(0, 90);
  // count the plan while the Plan tab is open
  const steps = await win.evaluate(() => { window.__hymnixDev.setChatTab("plan"); return document.querySelectorAll(".plan-step").length; });
  plan = Math.max(plan, steps);
  await win.evaluate(() => window.__hymnixDev.setChatTab("chat"));
  if (state.drawer && state.rows) {
    approval = true;
    console.log("APPROVAL_AT " + i);
    await win.evaluate(() => { const row = document.querySelector(".approval-row"); [...(row?.querySelectorAll("button") ?? [])].find((el) => (el.textContent || "").includes("允许一次"))?.click(); });
    await win.waitForTimeout(2500);
    continue;
  }
  if (state.bodies.length && !state.generating) { reply = state.bodies[state.bodies.length - 1]; break; }
  if (i % 6 === 0) console.log("T" + i + " " + JSON.stringify({ plan, drawer: state.drawer, bodies: state.bodies.length }));
}
console.log("NATIVE_RESULT " + JSON.stringify({ ready, plan, approval, reply: reply.slice(0, 60), error, file: existsSync(target), fileText: existsSync(target) ? readFileSync(target, "utf8").slice(0, 30) : null }));
await win.evaluate(() => window.__hymnixDev.setChatTab("plan"));
await win.waitForTimeout(400);
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/native-final.png") });
await app.close();
