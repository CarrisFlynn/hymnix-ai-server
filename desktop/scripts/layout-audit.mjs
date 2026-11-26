import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-layout", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.waitForTimeout(1200);

const audit = () => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const bodyOverflow = { x: document.documentElement.scrollWidth - document.documentElement.clientWidth, y: document.documentElement.scrollHeight - document.documentElement.clientHeight };
  const beyond = [];
  const clipped = [];
  const selectors = [".page-head h2", ".card-title", ".btn", ".cb-chip", ".nav-item", ".statusbar", ".chat-title", ".job-row-main strong", ".shortcut-edit-label", ".approval-row-head strong", ".plan-text", ".settings-nav button", ".theme-card-copy strong", ".mp-option-name"];
  for (const selector of selectors) {
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1) beyond.push(selector + ":" + Math.round(r.right - vw));
      const style = getComputedStyle(el);
      const clips = el.scrollWidth > el.clientWidth + 2 && (style.overflow === "hidden" || style.overflowX === "hidden" || style.textOverflow === "ellipsis");
      if (clips && !el.hasAttribute("title") && !el.getAttribute("aria-label")) clipped.push(selector + ":" + el.textContent.trim().slice(0, 24));
    }
  }
  return { vw, vh, bodyOverflow, beyond: beyond.slice(0, 8), clipped: clipped.slice(0, 8) };
};

const results = {};
const sizes = [[1926, 1200], [1440, 900], [1024, 700], [800, 560]];
const pages = ["Chat", "Models", "Gateway", "Plugins", "Monitor", "Terminal", "Jobs", "Changelog", "Support", "Settings"];
for (const [width, height] of sizes) {
  await win.setViewportSize({ width, height });
  await win.waitForTimeout(500);
  for (const page of pages) {
    await win.evaluate((target) => window.__hymnixDev.navigate(target), page);
    await win.waitForTimeout(450);
    results[width + "x" + height + " " + page] = await win.evaluate(audit);
  }
  // settings sections
  await win.evaluate(() => window.__hymnixDev.navigate("Settings"));
  for (const section of ["General", "Appearance", "Startup and runtime", "Models and storage", "Sharing and security", "Shortcuts", "About"]) {
    await win.evaluate((name) => window.__hymnixDev.setSettingsSection(name), section);
    await win.waitForTimeout(350);
    results[width + "x" + height + " Settings/" + section] = await win.evaluate(audit);
  }
}
// overlays
await win.setViewportSize({ width: 1024, height: 700 });
await win.evaluate(() => window.__hymnixDev.navigate("Chat"));
await win.waitForTimeout(400);
await win.keyboard.press("Control+/");
await win.waitForTimeout(400);
results["1024x700 shortcuts-sheet"] = await win.evaluate(audit);
await win.keyboard.press("Escape");
await win.keyboard.press("Control+Shift+A");
await win.waitForTimeout(400);
results["1024x700 approvals-drawer"] = await win.evaluate(audit);
await win.keyboard.press("Escape");
await win.locator(".cb-chip.model").click();
await win.waitForTimeout(400);
results["1024x700 model-popover"] = await win.evaluate(audit);
await win.keyboard.press("Escape");

const problems = Object.entries(results).filter(([, value]) => value.bodyOverflow.x > 0 || value.beyond.length || value.clipped.length);
console.log("PROBLEM_KEYS " + JSON.stringify(problems.map(([key, value]) => ({ key, ...value })), null, 1).slice(0, 6000));
fs.writeFileSync(resolve(cwd, "../docs/audit-1.4.0/layout.json"), JSON.stringify(results, null, 1), "utf8");
await app.close();
