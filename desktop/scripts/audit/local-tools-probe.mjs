import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-local-tools", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.3"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
for (let i = 0; i < 40; i += 1) { const b = await win.evaluate(() => window.hymnix.bootstrap()); if (b.ready) break; await win.waitForTimeout(400); }

const listed = await win.evaluate(() => window.hymnix.tools.list());
const names = (listed.tools || []).map((t) => t.name);
console.log("TOOLS_COUNT " + names.length);
console.log("TOOLS_HAS " + ["fs.read","fs.write","fs.edit","patch.apply","repo.tree","repo.search","time.now","calc","sysinfo"].filter((n) => names.includes(n)).join(","));

const call = (tool, args) => win.evaluate(async ([t, a]) => window.hymnix.tools.call({ requestId: "probe-" + Math.random().toString(36).slice(2), tool: t, args: a }), [tool, args]);
const write = await call("fs.write", { path: ".hx-probe.txt", content: "alpha\nbeta\ngamma\n" });
console.log("WRITE " + JSON.stringify(write));
const read = await call("fs.read", { path: ".hx-probe.txt" });
console.log("READ " + JSON.stringify(read).slice(0, 200));
const edit = await call("fs.edit", { path: ".hx-probe.txt", find: "beta", replace: "BETA" });
console.log("EDIT " + JSON.stringify(edit));
const after = await call("fs.read", { path: ".hx-probe.txt" });
console.log("AFTER " + JSON.stringify((after.result || {}).text));
const search = await call("repo.search", { q: "BETA", limit: 3 });
console.log("SEARCH " + JSON.stringify(search).slice(0, 220));
const escape = await call("fs.read", { path: "C:\\Windows\\win.ini" });
console.log("ESCAPE " + JSON.stringify(escape));
const clean = await call("fs.remove", { path: ".hx-probe.txt" });
console.log("CLEAN " + JSON.stringify(clean));
await app.close();
