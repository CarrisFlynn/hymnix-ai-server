import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-agent2", "."], cwd, env });
const win = await app.firstWindow();
const errors = [];
win.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.setItem("hymnix.surface","orbit"); localStorage.removeItem("hymnix.approvals.always.v1"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
// pick the model; do not preload it - sending must load on demand
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".mp-row-button")?.click());
await win.waitForTimeout(500);
await win.evaluate(() => [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen2.5-coder:7b"))?.click());
await win.keyboard.press("Escape");
await win.waitForTimeout(400);
const target = resolve(cwd, "../audit-agent2.txt");
if (existsSync(target)) rmSync(target);
await win.locator(".composer textarea").fill("调用 fs.write 工具，在 audit-agent2.txt 里写入内容 done，然后回答完成。");
await win.keyboard.press("Enter");
console.log("SENT " + JSON.stringify(await win.evaluate(() => ({ user: document.querySelectorAll(".bubble.user").length }))));
let sawApproval = false, replied = "", plan = 0, toolRuns = 0;
for (let i = 0; i < 70; i += 1) {
  await win.waitForTimeout(2000);
  const state = await win.evaluate(() => {
    const drawer = document.querySelector(".approvals-drawer");
    const rows = document.querySelectorAll(".approval-row").length;
    return {
      drawer: Boolean(drawer), rows,
      bodies: [...document.querySelectorAll(".bubble.assistant .bubble-body")].map((el) => el.textContent.trim()).filter(Boolean),
      evidence: document.querySelectorAll(".evidence-list li, .plan-evidence li").length,
    };
  });
  if (state.drawer && state.rows > 0) {
    sawApproval = true;
    console.log("APPROVAL " + JSON.stringify({ i, rows: state.rows }));
    await win.evaluate(() => { const row = document.querySelector(".approval-row"); [...(row?.querySelectorAll("button") ?? [])].find((el) => (el.textContent || "").includes("允许一次"))?.click(); });
    await win.waitForTimeout(2000);
    continue;
  }
  if (state.bodies.length && state.bodies[state.bodies.length - 1].length > 0) { replied = state.bodies[state.bodies.length - 1]; break; }
  if (i % 5 === 0) console.log("T" + i + " " + JSON.stringify({ bodies: state.bodies.length, drawer: state.drawer }));
}
console.log("RESULT " + JSON.stringify({ sawApproval, replied: replied.slice(0, 60), file: existsSync(target), fileText: existsSync(target) ? readFileSync(target, "utf8").slice(0, 40) : null, errors: errors.slice(0, 3) }));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/agent-final.png") });
await app.close();
