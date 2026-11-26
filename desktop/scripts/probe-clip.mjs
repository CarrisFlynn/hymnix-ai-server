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
await win.evaluate(() => {
  localStorage.setItem("hymnix.welcome", "1");
  localStorage.setItem("hymnix.whatsNew", "1.4.0");
  localStorage.setItem("hymnix.lang", "zh");
});
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());

const report = [];
const measure = (label) => win.evaluate((name) => {
  const box = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const scrolls = el.scrollHeight > el.clientHeight + 1;
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), width: Math.round(r.width), overflowY: style.overflowY, scrolls };
  };
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const clip = (b) => (b ? { overBottom: Math.max(0, b.bottom - vh), overRight: Math.max(0, b.width - vw), offTop: Math.max(0, -b.top) } : null);
  const targets = {
    sheet: box(".shortcuts-sheet"),
    sheetBody: box(".shortcuts-sheet-body"),
    drawer: box(".approvals-drawer"),
    drawerRows: box(".approval-rows"),
    planCard: box(".plan-card"),
    jobOutput: box(".job-output"),
    jobsLayout: box(".jobs-layout"),
  };
  return { name, vw, vh, targets, clip: Object.fromEntries(Object.entries(targets).map(([key, value]) => [key, clip(value)])) };
}, label);

for (const height of [900, 700, 640]) {
  await win.setViewportSize({ width: 1200, height });
  await win.waitForTimeout(500);

  // shortcut sheet
  await win.evaluate(() => window.__hymnixDev.openShortcuts());
  await win.waitForTimeout(400);
  report.push(await measure("sheet@" + height));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(250);

  // approvals drawer
  await win.evaluate(() => {
    window.__hymnixDev.seedApprovals([
      { id: "a".repeat(32), requestId: "r1", tool: "web.fetch", argsRedacted: { url: "https://example.com" }, risk: "moderate", reasons: ["tool requires approval"], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() },
      { id: "b".repeat(32), requestId: "r2", tool: "repo.search", argsRedacted: { query: "rm -rf" }, risk: "danger", reasons: ["recursive delete"], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() },
    ]);
    window.__hymnixDev.openApprovals();
  });
  await win.waitForTimeout(400);
  report.push(await measure("drawer@" + height));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(250);

  // plan
  await win.evaluate(() => {
    window.__hymnixDev.seedPlan({ todos: [
      { content: "Read the failing test", status: "completed" },
      { content: "Fix the assertion", status: "in_progress" },
      { content: "Run the full check gate", status: "pending" },
    ] });
    window.__hymnixDev.setChatTab("plan");
  });
  await win.waitForTimeout(500);
  report.push(await measure("plan@" + height));

  // jobs
  await win.evaluate(() => window.__hymnixDev.navigate("Jobs"));
  await win.waitForTimeout(400);
  await win.locator(".job-launcher input").fill("powershell -NoProfile -Command \"1..12 | ForEach-Object { Write-Output ('line ' + $_); Start-Sleep -Milliseconds 400 }\"");
  await win.locator(".job-launcher button[type=submit]").click();
  await win.waitForTimeout(1600);
  report.push(await measure("jobs@" + height));
  await win.locator(".job-detail .btn.danger").click().catch(() => undefined);
  await win.waitForTimeout(600);
}

console.log("CLIP_REPORT " + JSON.stringify(report));
await app.close();
