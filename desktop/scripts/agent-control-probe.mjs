import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-agentops", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.2"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }

const names = await win.evaluate(() => window.__hymnixDev.toolNames());
const want = ["agent.wait","agent.interrupt","list_session","session_search","worktree.list","worktree.create","worktree.remove"];
console.log("TOOL_COUNT " + names.length);
console.log("TOOL_NEW " + String(want.every((n) => names.includes(n))) + " missing=" + (want.filter((n) => !names.includes(n)).join(",") || "-"));

// 会话工具：真实会话存储
const seeded = await win.evaluate(() => {
  const rows = [{ id: "seed-1", name: "Renderer work", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), count: 2, model: "qwen3:8b", draft: "", pinned: true,
    messages: [{ role: "user", content: "Where is the tool loop?" }, { role: "assistant", content: "In main.tsx, streamTurn." }] }];
  localStorage.setItem("hymnix.chat.sessions.v2", JSON.stringify(rows));
  return true;
});
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
await win.waitForTimeout(800);
const listed = await win.evaluate(() => window.__hymnixDev.runTool("list_session", {}));
console.log("LIST_SESSION " + String(listed).slice(0, 220));
const searched = await win.evaluate(() => window.__hymnixDev.runTool("session_search", { query: "streamTurn" }));
console.log("SESSION_SEARCH " + String(searched).slice(0, 260));
const empty = await win.evaluate(() => window.__hymnixDev.runTool("session_search", { query: "  " }));
console.log("SESSION_SEARCH_EMPTY_REFUSED " + String(empty).includes("query_required"));

// worktree：没有工作区时必须诚实报错，不能假装成功
const wt = await win.evaluate(() => window.__hymnixDev.runTool("worktree.list", {}));
console.log("WORKTREE_LIST " + String(wt).slice(0, 200));
const wtBad = await win.evaluate(() => window.__hymnixDev.runTool("worktree.create", { name: "Bad Name!" }));
console.log("WORKTREE_BAD_NAME " + String(wtBad).includes("invalid_name"));

// agent.wait：没有运行中的代理时必须立即返回空，而不是挂住
const waited = await win.evaluate(() => window.__hymnixDev.runTool("agent.wait", { timeoutSeconds: 5 }));
console.log("AGENT_WAIT_EMPTY " + String(waited).slice(0, 160));
const interrupt = await win.evaluate(() => window.__hymnixDev.runTool("agent.interrupt", { name: "nobody" }));
console.log("AGENT_INTERRUPT_NOT_RUNNING " + String(interrupt).includes("not_running"));

await app.close();
