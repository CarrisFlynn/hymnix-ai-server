import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-pty-ui", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.3"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1500, height: 940 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const b = await win.evaluate(() => window.hymnix.bootstrap()); if (b.ready) break; await win.waitForTimeout(500); }

await win.evaluate(() => window.__hymnixDev.navigate("Terminal"));
await win.waitForTimeout(700);
const before = await win.evaluate(() => ({
  modes: [...document.querySelectorAll(".term-mode-switch button")].map((b) => b.textContent),
  xterm: Boolean(document.querySelector(".xterm")),
}));
console.log("PTY_UI_MODES " + JSON.stringify(before.modes) + " xtermVisibleBefore=" + before.xterm);

await win.evaluate(() => { const b = [...document.querySelectorAll(".term-mode-switch button")].find((x) => x.textContent.includes("TERMINAL")); b?.click(); });
await win.waitForTimeout(600);
const opened = await win.evaluate(() => ({
  xterm: Boolean(document.querySelector(".xterm")),
  rows: Boolean(document.querySelector(".xterm-rows")),
  button: document.querySelector(".pty-bar .term-btn")?.textContent,
  profile: document.querySelector(".pty-bar select")?.value,
}));
console.log("PTY_UI_SHELL " + JSON.stringify(opened));

await win.evaluate(() => document.querySelector(".pty-bar .term-btn")?.click());
await win.waitForTimeout(2500);
await win.evaluate(() => document.querySelector(".pty-screen .xterm")?.click());
await win.keyboard.type("echo hymnix-pty-ok");
await win.keyboard.press("Enter");
await win.waitForTimeout(2000);
const text = await win.evaluate(() => {
  const term = window.__ptyTerm;
  if (!term) return "";
  const buffer = term.buffer.active;
  const lines = [];
  for (let i = 0; i < buffer.length; i += 1) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join("\n");
});
console.log("PTY_UI_OUTPUT " + JSON.stringify(text.replace(/\s+/g, " ").slice(-160)));
console.log("PTY_UI_MATCH " + String(text.includes("hymnix-pty-ok")));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/pty-terminal.png") });
await app.close();
