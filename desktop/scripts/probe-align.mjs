import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// Isolated profile: a user-launched installed copy holds the single-instance
// lock, and verification must never steal their window.
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-verify-profile", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.removeItem("hymnix.shortcuts.v1"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
await win.setViewportSize({ width: 1440, height: 900 });
await win.waitForTimeout(600);

const edges = (selector, prop) => {
  const values = [...document.querySelectorAll(selector)].map((el) => Math.round(el.getBoundingClientRect()[prop]));
  return { values, unique: [...new Set(values)].length };
};

// ---- plan
await win.evaluate(() => {
  window.__hymnixDev.seedPlan({ todos: [
    { content: "Read the failing test and the code it covers", status: "completed" },
    { content: "Fix the assertion in components.test.mjs", status: "completed" },
    { content: "Run the full check gate", status: "in_progress" },
    { content: "Update CHANGELOG for 1.4.0", status: "pending" },
  ] });
  window.__hymnixDev.setChatTab("plan");
});
await win.waitForTimeout(700);
const planEdges = await win.evaluate(() => {
  const right = (s) => [...document.querySelectorAll(s)].map((el) => Math.round(el.getBoundingClientRect().right));
  const left = (s) => [...document.querySelectorAll(s)].map((el) => Math.round(el.getBoundingClientRect().left));
  return { metaRight: right(".plan-meta"), intentRight: right(".plan-intent"), dotLeft: left(".plan-dot"), indexLeft: left(".plan-index") };
});
console.log("PLAN_EDGES", JSON.stringify(planEdges));
await win.locator(".plan-card").screenshot({ path: resolve(cwd, "../.align-plan.png") });

// ---- shortcuts editor
await win.evaluate(() => window.__hymnixDev.setSettingsSection("Shortcuts"));
await win.waitForTimeout(700);
const editorEdges = await win.evaluate(() => {
  const btnRight = [...document.querySelectorAll(".shortcut-edit-row .btn")].map((el) => Math.round(el.getBoundingClientRect().right));
  const kbdRight = [...document.querySelectorAll(".shortcut-edit-row .shortcut-keys")].map((el) => Math.round(el.getBoundingClientRect().right));
  return { btnRightUnique: [...new Set(btnRight)].length, kbdRightUnique: [...new Set(kbdRight)].length, sample: kbdRight.slice(0, 6) };
});
console.log("EDITOR_EDGES", JSON.stringify(editorEdges));
await win.locator(".settings-content .card").first().screenshot({ path: resolve(cwd, "../.align-editor.png") });

// ---- jobs with several rows
await win.evaluate(() => window.__hymnixDev.navigate("Jobs"));
await win.waitForTimeout(500);
for (let i = 0; i < 4; i += 1) {
  await win.locator(".job-launcher input").fill("powershell -NoProfile -Command \"Write-Output result" + i + "\"");
  await win.locator(".job-launcher button[type=submit]").click();
  await win.waitForTimeout(420);
}
await win.waitForTimeout(700);
const jobEdges = await win.evaluate(() => {
  const right = (s) => [...document.querySelectorAll(s)].map((el) => Math.round(el.getBoundingClientRect().right));
  return { timeRight: right(".job-time"), exitRight: right(".job-exit"), count: document.querySelectorAll(".job-row").length };
});
console.log("JOB_EDGES", JSON.stringify(jobEdges));
await win.screenshot({ path: resolve(cwd, "../.align-jobs.png") });

// ---- shortcut sheet at 640
await win.setViewportSize({ width: 1200, height: 640 });
await win.waitForTimeout(400);
await win.evaluate(() => window.__hymnixDev.navigate("Chat"));
await win.waitForTimeout(300);
await win.evaluate(() => window.__hymnixDev.openShortcuts());
await win.waitForTimeout(500);
const sheet = await win.evaluate(() => {
  const el = document.querySelector(".shortcuts-sheet");
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, gapTop: Math.round(r.top), gapBottom: Math.round(window.innerHeight - r.bottom) };
});
console.log("SHEET_640", JSON.stringify(sheet));
await win.screenshot({ path: resolve(cwd, "../.align-sheet-640.png") });
await app.close();
