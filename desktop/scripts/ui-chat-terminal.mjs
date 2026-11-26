import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-ui2", "."], cwd, env });
const win = await app.firstWindow();
const errors = [];
win.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
win.on("close", () => console.log("WINDOW_CLOSED_EARLY"));
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:0.6b"); } catch { /* ignore */ } });
await win.waitForTimeout(800);

// pick qwen3:0.6b through the real popover path: chip -> "Model" row -> option
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(400);
const rowClicked = await win.evaluate(() => {
  const row = document.querySelector(".mp-row-button");
  row?.click();
  return Boolean(row);
});
await win.waitForTimeout(500);
const optionCount = await win.locator(".mp-option").count();
const picked = await win.evaluate(() => {
  const option = [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen3:0.6b"));
  option?.click();
  return Boolean(option);
});
console.log("PICK", JSON.stringify({ rowClicked, optionCount, picked }));
await win.keyboard.press("Escape");
await win.waitForTimeout(600);
console.log("MODEL_CHIP", await win.locator(".cb-chip.model").textContent());

// chat
await win.locator(".composer textarea").fill("Reply with exactly one word: pong");
await win.keyboard.press("Enter");
let reply = "";
for (let i = 0; i < 45; i += 1) {
  await win.waitForTimeout(1000);
  reply = await win.evaluate(() => {
    const bodies = [...document.querySelectorAll(".bubble.assistant .bubble-body")];
    const last = bodies[bodies.length - 1];
    return last ? last.textContent.trim() : "";
  });
  const busy = await win.evaluate(() => Boolean(document.querySelector(".bubble.assistant.generating")));
  if (reply && !busy) break;
}
console.log("CHAT", JSON.stringify({ chars: reply.length, sample: reply.slice(0, 80) }));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/ui-chat.png") });

// terminal
await win.evaluate(() => window.__hymnixDev.navigate("Terminal"));
await win.waitForTimeout(700);
await win.locator(".term-input input").fill("echo matrix-probe");
await win.locator(".term-input").press("Enter");
await win.waitForTimeout(3000);
const termText = await win.evaluate(() => document.querySelector(".term-log, .terminal-view, .terminal-page")?.textContent || "");
console.log("TERMINAL", JSON.stringify({ ran: termText.includes("matrix-probe"), sample: termText.slice(-160) }));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/ui-terminal.png") });

console.log("PAGE_ERRORS", JSON.stringify(errors.slice(0, 5)));
await app.close();
