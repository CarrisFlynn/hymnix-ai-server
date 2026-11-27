import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
const cwd = resolve(process.cwd());
const profile = mkdtempSync(resolve(tmpdir(), "hx-boot-"));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=" + profile, "."], cwd, env });
const win = await app.firstWindow();
win.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE " + m.text().slice(0, 200)); });
await win.waitForFunction(() => Boolean(window.hymnix && window.hymnix.bootstrap), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome", "1"); localStorage.setItem("hymnix.whatsNew", "18"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.hymnix && window.hymnix.bootstrap), null, { timeout: 60000 });
let last = null;
for (let i = 0; i < 12; i += 1) {
  try { last = await win.evaluate(() => window.hymnix.bootstrap()); } catch (e) { last = { error: String(e).slice(0, 300) }; }
  console.log("BOOT[" + i + "] " + JSON.stringify(last).slice(0, 300));
  if (last && last.ready) break;
  await win.waitForTimeout(1000);
}
await app.close();