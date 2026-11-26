import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-matrix", "."], cwd, env });
const win = await app.firstWindow();
const errors = [];
win.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => {
  localStorage.setItem("hymnix.welcome", "1");
  localStorage.setItem("hymnix.whatsNew", "1.4.0");
  localStorage.setItem("hymnix.lang", "zh");
});
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
const results = {};
const record = (name, value) => { results[name] = value; console.log("CHECK " + name + " " + JSON.stringify(value)); };

// wait for the app to consider itself ready
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
record("gateway_ready", await win.evaluate(() => window.hymnix.bootstrap().then((b) => b.ready)));

// --- models: list, load, select
const models = await win.evaluate(() => window.hymnix.models.list().then((r) => r.models.map((m) => m.name)));
record("models_listed", models.length);
const loadResult = await win.evaluate(async () => { try { await window.hymnix.models.start("qwen3:0.6b"); return "ok"; } catch (error) { return String(error).slice(0, 120); } });
record("model_load", loadResult);

// select qwen3:0.6b in the composer
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(500);
const picked = await win.evaluate(() => {
  const row = [...document.querySelectorAll(".mp-option")].find((el) => (el.textContent || "").includes("qwen3:0.6b"));
  if (row) row.click();
  return Boolean(row);
});
record("model_select", picked);
await win.keyboard.press("Escape");
await win.waitForTimeout(600);

// --- chat
await win.locator(".composer textarea").click();
await win.locator(".composer textarea").fill("Reply with exactly one word: pong");
await win.keyboard.press("Enter");
let reply = "";
for (let i = 0; i < 90; i += 1) {
  await win.waitForTimeout(1000);
  reply = await win.evaluate(() => {
    const bubbles = [...document.querySelectorAll(".bubble.assistant .bubble-body")];
    return bubbles.length ? bubbles[bubbles.length - 1].textContent.trim() : "";
  });
  if (reply) break;
}
record("chat_reply", { chars: reply.length, sample: reply.slice(0, 60) });

// --- terminal
await win.evaluate(() => window.__hymnixDev.navigate("Terminal"));
await win.waitForTimeout(800);
const term = await win.evaluate(() => Boolean(document.querySelector(".terminal-input, .term-input, input[aria-label]")));
record("terminal_present", term);
await win.keyboard.type("echo matrix-probe");
await win.keyboard.press("Enter");
await win.waitForTimeout(2500);
const termOut = await win.evaluate(() => (document.querySelector(".terminal-view, .term-view, .terminal-page")?.textContent || "").includes("matrix-probe"));
record("terminal_ran_command", termOut);

// --- jobs
await win.evaluate(() => window.__hymnixDev.navigate("Jobs"));
await win.waitForTimeout(600);
await win.locator(".job-launcher input").fill("powershell -NoProfile -Command \"Write-Output matrix-job\"");
await win.locator(".job-launcher button[type=submit]").click();
await win.waitForTimeout(2000);
record("job_ran", await win.evaluate(() => ({
  rows: document.querySelectorAll(".job-row").length,
  output: (document.querySelector(".job-output")?.textContent || "").includes("matrix-job"),
})));

// --- plan (Orbit + tool loop)
await win.evaluate(() => window.__hymnixDev.navigate("Chat"));
await win.waitForTimeout(500);
await win.evaluate(() => {
  const trigger = document.querySelector(".side-product, .product-switch, .side-brand");
  trigger?.click();
});
await win.waitForTimeout(400);
await win.evaluate(() => {
  const orbit = [...document.querySelectorAll(".product-menu button, [role=menuitemradio], .menu-item")].find((el) => (el.textContent || "").includes("Orbit"));
  orbit?.click();
});
await win.waitForTimeout(800);
record("surface_orbit", await win.evaluate(() => (document.querySelector(".side-brand-name")?.textContent || "").trim()));
await win.evaluate(() => { const plus = document.querySelector(".btn.primary, .composer .cb-icon"); plus?.click(); });
await win.evaluate(() => window.__hymnixDev.navigate("Chat"));
await win.waitForTimeout(400);
// new session so the mode applies cleanly
await win.keyboard.press("Control+n");
await win.waitForTimeout(700);
await win.locator(".composer textarea").click();
await win.locator(".composer textarea").fill("Use the todo_write tool to publish two steps, then answer done.");
await win.keyboard.press("Enter");
let planSteps = 0;
for (let i = 0; i < 60; i += 1) {
  await win.waitForTimeout(1000);
  planSteps = await win.evaluate(() => {
    window.__hymnixDev.setChatTab("plan");
    return document.querySelectorAll(".plan-step").length;
  });
  if (planSteps > 0) break;
}
record("plan_steps", planSteps);

// --- pages and settings
const pages = ["Models", "Gateway", "Plugins", "Monitor", "Changelog", "Support", "Settings"];
const pageErrors = {};
for (const page of pages) {
  const before = errors.length;
  await win.evaluate((target) => window.__hymnixDev.navigate(target), page);
  await win.waitForTimeout(900);
  pageErrors[page] = errors.length > before ? errors.slice(before) : "ok";
}
record("pages", pageErrors);

// --- shortcuts sheet
await win.evaluate(() => window.__hymnixDev.navigate("Chat"));
await win.waitForTimeout(400);
await win.keyboard.press("Control+/");
await win.waitForTimeout(500);
record("shortcuts_sheet", await win.evaluate(() => Boolean(document.querySelector(".shortcuts-sheet"))));
await win.keyboard.press("Escape");

// --- approvals inbox opens (empty)
await win.keyboard.press("Control+Shift+A");
await win.waitForTimeout(600);
record("approvals_drawer", await win.evaluate(() => Boolean(document.querySelector(".approvals-drawer"))));
await win.keyboard.press("Escape");

// --- theme switch
await win.evaluate(() => window.__hymnixDev.navigate("Settings"));
await win.waitForTimeout(500);
await win.evaluate(() => window.__hymnixDev.setSettingsSection("Appearance"));
await win.waitForTimeout(500);
const themeBefore = await win.evaluate(() => document.documentElement.dataset.theme);
await win.evaluate(() => { const card = document.querySelectorAll(".theme-card")[3]; card?.click(); });
await win.waitForTimeout(800);
record("theme_switch", { before: themeBefore, after: await win.evaluate(() => document.documentElement.dataset.theme) });

record("console_errors", errors.slice(0, 6));
fs.writeFileSync(resolve(cwd, "../docs/audit-1.4.0/matrix.json"), JSON.stringify(results, null, 2), "utf8");
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/matrix-final.png") });
await app.close();
