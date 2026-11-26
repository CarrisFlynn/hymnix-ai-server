import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-crash", "."], cwd, env });
const win = await app.firstWindow();
app.process().stderr?.on("data", (chunk) => console.log("MAIN_STDERR " + chunk.toString().trim().slice(0, 300)));
win.on("crash", () => console.log("RENDERER_CRASH"));
win.on("close", () => console.log("WINDOW_CLOSE"));
app.on("window-all-closed", () => console.log("ALL_WINDOWS_CLOSED"));
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
await win.waitForTimeout(400);
await win.locator(".composer textarea").fill("调用 todo_write 发布两步计划，然后调用 fs.write 写入 audit-crash.txt 内容 done。");
await win.keyboard.press("Enter");
for (let i = 0; i < 40; i += 1) {
  await win.waitForTimeout(1500);
  try {
    const state = await win.evaluate(() => ({
      user: document.querySelectorAll(".bubble.user").length,
      assistant: document.querySelectorAll(".bubble.assistant").length,
      body: [...document.querySelectorAll(".bubble.assistant .bubble-body")].map((el) => el.textContent.trim()).join("|").slice(0, 80),
      drawer: Boolean(document.querySelector(".approvals-drawer")),
      plan: document.querySelectorAll(".plan-step").length,
    }));
    if (i % 4 === 0) console.log("T" + i + " " + JSON.stringify(state));
    if (state.drawer) { console.log("DRAWER_AT " + i); break; }
  } catch (error) { console.log("EVAL_FAILED " + i + " " + String(error).slice(0, 120)); break; }
}
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/crash.png") }).catch(() => console.log("SHOT_FAILED"));
await app.close().catch(() => undefined);
