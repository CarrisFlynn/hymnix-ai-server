import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-agent-cli", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.3"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
for (let i = 0; i < 40; i += 1) { const b = await win.evaluate(() => window.hymnix.bootstrap()); if (b.ready) break; await win.waitForTimeout(400); }

const session = await win.evaluate(async () => {
  window.__agentChunks = [];
  window.hymnix.pty.onData((e) => { if (e.id === "agentrun") window.__agentChunks.push(e.data); });
  const opened = await window.hymnix.pty.open({ id: "agentrun", profile: "agent", cwd: "", cols: 110, rows: 32 });
  return opened;
});
console.log("OPEN " + JSON.stringify(session));
await win.waitForTimeout(3500);
await win.evaluate(() => window.hymnix.pty.write("agentrun", "6\r"));   // 选 qwen3:8b
await win.waitForTimeout(2500);
await win.evaluate(() => window.hymnix.pty.write("agentrun", "只做一件事：调用 fs.read 工具，参数 path=package.json。不要写代码，不要解释。\r"));
await win.waitForTimeout(45000);
const out = await win.evaluate(() => window.__agentChunks.join(""));
const clean = out.replace(/\x1b\][^\u0007]*\u0007/g, "").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
console.log("REPLY " + JSON.stringify(clean.slice(-700)));
await win.evaluate(() => window.hymnix.pty.close("agentrun"));
await app.close();
