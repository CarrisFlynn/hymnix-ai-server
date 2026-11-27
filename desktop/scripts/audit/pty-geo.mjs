import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-shots-clean", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.lang","en"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
for (let i = 0; i < 60; i += 1) { const b = await win.evaluate(() => window.hymnix.bootstrap()); if (b.ready) break; await win.waitForTimeout(500); }
await win.evaluate(() => window.__hymnixDev.navigate("Terminal"));
await win.waitForTimeout(800);
await win.evaluate(() => { const b = [...document.querySelectorAll(".term-mode-switch button")].find((x) => /TERMINAL/i.test(x.textContent)); b?.click(); });
await win.waitForTimeout(800);
await win.evaluate(() => document.querySelector(".pty-bar .term-btn")?.click());
await win.waitForTimeout(4000);
const geo = await win.evaluate(() => {
  const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), display: cs.display, alignItems: cs.alignItems, position: cs.position }; };
  return { screen: pick('.pty-screen'), xterm: pick('.xterm'), viewport: pick('.xterm-viewport'), canvas: pick('.xterm canvas'), term: window.__ptyTerm ? { cols: window.__ptyTerm.cols, rows: window.__ptyTerm.rows } : null };
});
console.log("GEO " + JSON.stringify(geo));
await app.close();