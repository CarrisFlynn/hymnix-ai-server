import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";

const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-agent", "."], cwd, env });
const win = await app.firstWindow();
const errors = [];
win.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.removeItem("hymnix.approvals.always.v1"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }

// Orbit + a tool-capable model
await win.locator(".side-brand").click();
await win.waitForTimeout(300);
await win.evaluate(() => { [...document.querySelectorAll("[role=menuitemradio], .product-menu button")].find((el) => (el.textContent || "").includes("Orbit"))?.click(); });
await win.waitForTimeout(500);
const loaded = await win.evaluate(async () => { try { await window.hymnix.models.start("qwen2.5-coder:7b"); return "ok"; } catch (error) { return String(error).slice(0, 160); } });
console.log("MODEL_LOAD " + JSON.stringify(loaded));
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(500);
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen2.5-coder:7b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(500);
console.log("MODEL_CHIP " + JSON.stringify((await win.locator(".cb-chip.model").textContent())?.trim()));

const target = resolve(cwd, "../audit-agent.txt");
if (existsSync(target)) rmSync(target);

await win.locator(".composer textarea").fill("请调用 todo_write 发布两步计划（第一步写文件，第二步确认），然后调用 fs.write 在 audit-agent.txt 里写入内容 done，最后回答：完成。");
await win.keyboard.press("Enter");

let planSteps = 0;
let sawApproval = false;
let replied = "";
for (let i = 0; i < 120; i += 1) {
  await win.waitForTimeout(1500);
  const state = await win.evaluate(() => ({
    drawer: Boolean(document.querySelector(".approvals-drawer")),
    plan: (window.__hymnixDev.setChatTab("plan"), document.querySelectorAll(".plan-step").length),
    pending: document.querySelectorAll(".approval-row").length,
    lastReply: [...document.querySelectorAll(".bubble.assistant .bubble-body")].map((el) => el.textContent.trim()).filter(Boolean).slice(-1)[0] ?? "",
  }));
  planSteps = Math.max(planSteps, state.plan);
  if (state.drawer && state.pending > 0) {
    sawApproval = true;
    console.log("APPROVAL_SHOWN " + JSON.stringify({ i, pending: state.pending }));
    await win.evaluate(() => { const row = document.querySelector(".approval-row"); const allow = [...(row?.querySelectorAll("button") ?? [])].find((el) => (el.textContent || "").includes("允许一次")); allow?.click(); });
    await win.waitForTimeout(2500);
    continue;
  }
  if (state.lastReply && state.lastReply.length > 1 && !state.drawer) { replied = state.lastReply; break; }
}
console.log("RESULT " + JSON.stringify({
  planSteps,
  sawApproval,
  replied: replied.slice(0, 80),
  fileWritten: existsSync(target),
  fileText: existsSync(target) ? readFileSync(target, "utf8").slice(0, 60) : null,
  errors: errors.slice(0, 3),
}));
await win.evaluate(() => window.__hymnixDev.setChatTab("plan"));
await win.waitForTimeout(400);
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/agent-plan.png") });
await app.close();
