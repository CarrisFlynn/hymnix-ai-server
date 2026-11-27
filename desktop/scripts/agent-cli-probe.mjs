import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-agent-cli", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.3"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1500, height: 940 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const b = await win.evaluate(() => window.hymnix.bootstrap()); if (b.ready) break; await win.waitForTimeout(400); }

const profiles = await win.evaluate(() => window.hymnix.pty.profiles());
console.log("PROFILES " + JSON.stringify((profiles.profiles || []).map((p) => p.id + ":" + p.available)));

await win.evaluate(() => window.__hymnixDev.navigate("Terminal"));
await win.waitForTimeout(500);
await win.evaluate(() => { const b = [...document.querySelectorAll(".term-mode-switch button")].find((x) => x.textContent.includes("TERMINAL")); b?.click(); });
await win.waitForTimeout(600);
await win.evaluate(() => { const sel = document.querySelector(".pty-bar select"); if (sel) { sel.value = "agent"; sel.dispatchEvent(new Event("change", { bubbles: true })); } });
await win.waitForTimeout(300);
await win.evaluate(() => document.querySelector(".pty-bar .term-btn")?.click());
await win.waitForTimeout(4000);
const text = await win.evaluate(() => {
  const term = window.__ptyTerm; if (!term) return "NO_TERM";
  const b = term.buffer.active; const out = [];
  for (let i = 0; i < b.length; i += 1) { const l = b.getLine(i); if (l) out.push(l.translateToString(true)); }
  return out.join("\n").trim();
});
console.log("CLI_SCREEN " + JSON.stringify(text.slice(0, 600)));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/agent-cli.png") });
await app.close();
