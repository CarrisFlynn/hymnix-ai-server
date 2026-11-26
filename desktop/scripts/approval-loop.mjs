import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-approval", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }

const tools = await win.evaluate(() => window.hymnix.tools.list().then((r) => r.tools.map((t) => t.name)));
console.log("TOOLS " + JSON.stringify(tools));

const first = await win.evaluate(async () => {
  try { return await window.hymnix.tools.call({ requestId: "ap-1", tool: "fs.write", args: { path: "audit-probe.txt", content: "approval loop works" } }); }
  catch (error) { return { error: String(error).slice(0, 200) }; }
});
console.log("FIRST_CALL " + JSON.stringify(first).slice(0, 400));

const pending = await win.evaluate(() => window.hymnix.tools.pending());
console.log("PENDING " + JSON.stringify({ count: pending.count, tools: pending.approvals.map((row) => row.tool) }));

const decided = await win.evaluate(async () => {
  const list = await window.hymnix.tools.pending();
  if (!list.approvals.length) return { error: "none" };
  const id = list.approvals[0].id;
  try { return await window.hymnix.tools.approve(id); } catch (error) { return { error: String(error).slice(0, 200) }; }
});
console.log("APPROVED " + JSON.stringify(decided).slice(0, 300));

const target = resolve(cwd, "../audit-probe.txt");
console.log("FILE " + JSON.stringify({ exists: existsSync(target), text: existsSync(target) ? readFileSync(target, "utf8") : null }));
if (existsSync(target)) rmSync(target);
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/approval-loop.png") });
await app.close();
