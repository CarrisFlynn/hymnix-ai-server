import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-term-look", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","9.9.9"); localStorage.setItem("hymnix.lang","en"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
for (let i = 0; i < 60; i += 1) { const b = await win.evaluate(() => window.hymnix.bootstrap()); if (b.ready) break; await win.waitForTimeout(500); }
await win.evaluate(() => window.__hymnixDev.navigate("Terminal"));
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
await win.waitForTimeout(800);
await win.evaluate(() => { const b = [...document.querySelectorAll(".term-mode-switch button")].find((x) => /TERMINAL/i.test(x.textContent)); b?.click(); });
await win.waitForTimeout(700);
await win.evaluate(() => document.querySelector(".pty-bar .term-btn")?.click());
await win.waitForTimeout(6000);
await win.evaluate(() => window.hymnix.pty.write("look", "\r"));
await win.waitForTimeout(2500);
const geo = await win.evaluate(() => {
  const el = document.querySelector('.xterm');
  const r = el.getBoundingClientRect();
  const b = window.__ptyTerm.buffer.active;
  let firstText = -1;
  for (let i = 0; i < b.length; i += 1) { const line = b.getLine(i); if (line && line.translateToString(true).trim()) { firstText = i; break; } }
  return { w: Math.round(r.width), h: Math.round(r.height), cols: window.__ptyTerm.cols, rows: window.__ptyTerm.rows, firstTextRow: firstText, baseY: b.baseY };
});
console.log("GEO " + JSON.stringify(geo));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/term-look.png") });
await app.close();