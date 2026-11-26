import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-verify-profile", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
await win.waitForTimeout(700);

await win.evaluate(() => window.__hymnixDev.seedApprovals([
  { id: "c".repeat(32), requestId: "r1", tool: "repo.search", argsRedacted: { query: "rm -rf" }, risk: "danger", reasons: ["recursive delete"], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() },
]));
await win.waitForTimeout(500);
const badge = await win.evaluate(() => {
  const el = document.querySelector(".tb-badges .head-badge");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { right: Math.round(r.right), top: Math.round(r.top), h: Math.round(r.height), titlebarWidth: Math.round(document.querySelector(".titlebar").getBoundingClientRect().width), text: el.textContent?.trim() };
});
console.log("BADGE_BOX", JSON.stringify(badge));
await win.locator(".tb-badges .head-badge").click();
await win.waitForTimeout(600);
const opened = await win.evaluate(() => Boolean(document.querySelector(".approvals-drawer")));
console.log("BADGE_CLICK_OPENS_DRAWER", String(opened));
await win.screenshot({ path: resolve(cwd, "../.align-badges.png") });
await win.keyboard.press("Escape");
await win.waitForTimeout(300);

// jobs badge: start a job, click the pill, land on Jobs
await win.evaluate(() => window.__hymnixDev.navigate("Chat"));
await win.waitForTimeout(300);
await win.evaluate(() => window.__hymnixDev.navigate("Jobs"));
await win.waitForTimeout(300);
await win.locator(".job-launcher input").fill("powershell -NoProfile -Command \"Start-Sleep -Seconds 20\"");
await win.locator(".job-launcher button[type=submit]").click();
await win.waitForTimeout(900);
await win.evaluate(() => window.__hymnixDev.navigate("Chat"));
await win.waitForTimeout(400);
await win.locator(".tb-badges .head-badge.live").click();
await win.waitForTimeout(700);
console.log("JOBS_BADGE_NAVIGATES", await win.evaluate(() => document.querySelector(".view-page h2")?.textContent));
await win.screenshot({ path: resolve(cwd, "../.align-badges-jobs.png") });
await win.evaluate(() => window.__hymnixDev.navigate("Jobs"));
await win.waitForTimeout(300);
await win.locator(".job-detail .btn.danger").click().catch(() => undefined);
await app.close();
