import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

/** Smoke test for the packaged build: does the shipped asar boot the 1.4 surfaces? */
const cwd = resolve(process.cwd());
const exe = resolve(cwd, "../release/win-unpacked/Hymnix Orbit.exe");
const env = { ...process.env };
// The harness sets this so Electron runs as plain Node; a packaged app must not inherit it.
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: exe, args: [], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 90000 });
await win.evaluate(() => {
  localStorage.setItem("hymnix.welcome", "1");
  localStorage.setItem("hymnix.whatsNew", "1.4.0");
  localStorage.setItem("hymnix.lang", "zh");
});
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 90000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
await win.waitForTimeout(1500);
const report = await win.evaluate(() => ({
  version: window.__hymnixDev.version,
  nav: [...document.querySelectorAll(".nav-item, .side-nav button, nav button")].map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 20),
  hasPlanTab: [...document.querySelectorAll(".chat-tabs button")].some((b) => b.textContent?.includes("计划")),
}));
console.log("PACKAGED", JSON.stringify(report));
await win.evaluate(() => window.__hymnixDev.navigate("Jobs"));
await win.waitForTimeout(800);
const jobs = await win.evaluate(() => ({
  title: document.querySelector(".view-page h2")?.textContent,
  launcher: Boolean(document.querySelector(".job-launcher")),
}));
console.log("PACKAGED_JOBS", JSON.stringify(jobs));
await win.screenshot({ path: resolve(cwd, "../release/1.4.0-packaged-jobs.png") });
await app.close();
